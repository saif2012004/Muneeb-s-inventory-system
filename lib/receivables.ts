import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * THE RECEIVABLES CALCULATION. One implementation, like reconcileSaleLines.
 *
 *   totalBilled = SUM(BeverageSale) + SUM(BakerySale) + SUM(MilkSale)
 *               + SUM(Sale)   <- the UNIFIED bill, added in S4.2
 *   totalPaid   = SUM(CustomerPayment)
 *   outstanding = totalBilled - totalPaid
 *
 * The list, the profile, the balance endpoint and any future report all call in
 * here. If they each did their own arithmetic they would eventually disagree,
 * and a customer ledger that disagrees with itself is worse than none.
 *
 * ---------------------------------------------------------------------------
 * MILK IS COUNTED NOW
 * ---------------------------------------------------------------------------
 * MilkSale is summed even though its UI lands in Phase 5. A customer may
 * already have milk sales, and a balance that silently omits a whole revenue
 * stream is wrong in the direction that loses the owner money. With the table
 * empty it contributes exactly 0, so including it costs nothing today.
 *
 * ---------------------------------------------------------------------------
 * TWO PRISMA BEHAVIOURS THIS MUST SURVIVE (verified against the v6 docs)
 * ---------------------------------------------------------------------------
 * 1. `_sum` returns NULL, not 0, when no rows match.
 * 2. `groupBy` omits a group ENTIRELY when it has no rows — a customer with no
 *    sales simply does not appear in the result set.
 *
 * Both mean "no rows" has to be normalised to zero deliberately. A customer
 * with no sales and no payments is a perfectly ordinary customer who owes
 * nothing; they must read as 0, never as null, NaN or an error.
 *
 * ---------------------------------------------------------------------------
 * AGGREGATION, NOT ITERATION
 * ---------------------------------------------------------------------------
 * Sums are computed in the DATABASE. Loading every sale row to add them up in
 * JS would be an N+1 that degrades as the business grows — precisely as the
 * ledger becomes worth reading. The whole-list path is a FIXED four queries no
 * matter how many customers exist.
 *
 * All money math stays on Decimal. Serialization to `number` happens once, at
 * the route boundary (Gotcha 2).
 */

const ZERO = new Prisma.Decimal(0);

/**
 * 🔴 THE UNIFIED SALE IS COUNTED — MINUS MIGRATION A's DUPLICATE.
 *
 * Without the guard the owner's one real customer is billed TWICE for the same
 * Rs. 5,000, because migration A's `Sale` row carries the id of the `BakerySale`
 * row it was copied from:
 *
 *     correct : 5,000 (bakery) + 6,000 (milk)             = 11,000
 *     naive   : 5,000 + 6,000 + 5,000 (the A copy)        = 16,000   ✗
 *
 * The rule itself lives in `lib/unified-sales.ts` — ONE definition, shared with
 * `lib/reports.ts`, which needs exactly the same exclusion for revenue. Written
 * as raw SQL because Prisma cannot express "id not in another table" in a
 * `where`, and doing it in JS would mean fetching the legacy ids first: two
 * extra round trips at ~1.1s each on a path the customers hub hits every
 * request.
 */

/** Raw Decimal balance. Serialize before it leaves a route handler. */
export type CustomerBalance = {
  totalBilled: Prisma.Decimal;
  totalPaid: Prisma.Decimal;
  /** billed − paid. Positive = the customer owes the owner. */
  outstanding: Prisma.Decimal;
  /** Most recent sale across ALL modules, or null if they've never bought. */
  lastSaleDate: Date | null;
  lastPaymentDate: Date | null;
};

/**
 * How a balance reads to the owner. Positive means money is owed TO the owner,
 * which the Design System paints rose (debt owed by others).
 *
 * A NEGATIVE balance is a real case, not an error: the customer paid more than
 * they were billed. Calling that "credit" and painting it emerald keeps the
 * sign meaningful instead of showing a confusing minus sign in a debt column.
 */
export type BalanceTone = "owed" | "settled" | "credit";

export function balanceTone(outstanding: number): BalanceTone {
  if (outstanding > 0) return "owed";
  if (outstanding < 0) return "credit";
  return "settled";
}

/** `_sum` is null when nothing matched — that means zero, not "unknown". */
function sumOrZero(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value ?? ZERO;
}

/** The later of two dates, either of which may be absent. */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------
// One customer
// ---------------------------------------------------------------------------

/**
 * Balance for a single customer. TWO aggregates, awaited in series — no sale
 * rows are transferred.
 *
 * It was five queries plus a raw statement until S9, because billed money was
 * spread over four sale tables and the unified one needed a NOT EXISTS to skip
 * rows that were copies of the others. `Sale` is now the only place a bill
 * exists, so the whole apparatus reduces to one aggregate.
 *
 * Sequential for the connection-pool reason documented on
 * {@link getCustomerActivity}: with `connection_limit=1` a Promise.all does not
 * run in parallel, it queues and can exhaust the pool timeout.
 */
export async function getCustomerBalance(
  customerId: string
): Promise<CustomerBalance> {
  const where = { customerId };

  const sales = await prisma.sale.aggregate({
    where,
    _sum: { totalAmount: true },
    _max: { saleDate: true },
  });
  const payments = await prisma.customerPayment.aggregate({
    where,
    _sum: { amount: true },
    _max: { paymentDate: true },
  });

  const totalBilled = sumOrZero(sales._sum.totalAmount);
  const totalPaid = sumOrZero(payments._sum.amount);

  return {
    totalBilled,
    totalPaid,
    outstanding: totalBilled.sub(totalPaid),
    lastSaleDate: sales._max.saleDate,
    lastPaymentDate: payments._max.paymentDate,
  };
}

// ---------------------------------------------------------------------------
// Every customer at once
// ---------------------------------------------------------------------------

/**
 * Balances for many customers in a FIXED two queries, regardless of how many
 * customers there are — the alternative (a balance query per customer) is the
 * N+1 this exists to avoid.
 *
 * Pass the ids you intend to display; every one is present in the result, so
 * callers never have to handle a missing entry. Customers with no activity get
 * a genuine zero balance rather than being absent (see the groupBy note above).
 */
export async function getCustomerBalances(
  customerIds: string[]
): Promise<Map<string, CustomerBalance>> {
  const balances = new Map<string, CustomerBalance>();
  if (customerIds.length === 0) return balances;

  // Seed every requested id with zero FIRST. groupBy returns nothing at all for
  // a customer with no rows, so without this a brand-new customer would be
  // missing from the map and read as undefined downstream.
  for (const id of customerIds) {
    balances.set(id, {
      totalBilled: ZERO,
      totalPaid: ZERO,
      outstanding: ZERO,
      lastSaleDate: null,
      lastPaymentDate: null,
    });
  }

  const where = { customerId: { in: customerIds } };

  // Awaited in series, not Promise.all — see getCustomerActivity for why
  // concurrency is a liability on a one-connection pool.
  const sales = await prisma.sale.groupBy({
    by: ["customerId"],
    where,
    _sum: { totalAmount: true },
    _max: { saleDate: true },
  });
  const payments = await prisma.customerPayment.groupBy({
    by: ["customerId"],
    where,
    _sum: { amount: true },
    _max: { paymentDate: true },
  });

  for (const group of sales) {
    const current = balances.get(group.customerId);
    if (!current) continue;
    current.totalBilled = current.totalBilled.add(
      sumOrZero(group._sum?.totalAmount)
    );
    current.lastSaleDate = laterOf(
      current.lastSaleDate,
      group._max?.saleDate ?? null
    );
  }

  for (const group of payments) {
    const current = balances.get(group.customerId);
    if (!current) continue;
    current.totalPaid = current.totalPaid.add(sumOrZero(group._sum?.amount));
    current.lastPaymentDate = laterOf(
      current.lastPaymentDate,
      group._max?.paymentDate ?? null
    );
  }

  // outstanding is derived last, once both sides are fully accumulated.
  balances.forEach((balance) => {
    balance.outstanding = balance.totalBilled.sub(balance.totalPaid);
  });

  return balances;
}

/**
 * Total money owed across the whole book, in TWO queries and without loading
 * or even listing customers.
 *
 * Lives here rather than in lib/reports.ts on purpose: it is a receivables
 * figure, and the rule is that receivables arithmetic has exactly one home.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ISN'T (SUM(billed) - SUM(paid))
 * ---------------------------------------------------------------------------
 * Only POSITIVE balances count. A customer in credit must not cancel another
 * customer's debt — netting them globally would report "nothing owed" while
 * someone still owes real money. So the grouping has to happen per customer
 * first, then the positives are summed. That is also exactly what the customers
 * hub does, which is what makes the two agree.
 *
 * No `in` filter and no id list: a customer with no rows at all contributes 0
 * to a sum of positives, so enumerating them first would be a wasted query.
 */
export async function getTotalOutstanding(): Promise<Prisma.Decimal> {
  // No `in` filter and no id list: a customer with no rows contributes 0 to a
  // sum of positives, so enumerating them first would be a wasted round trip.
  const sales = await prisma.sale.groupBy({
    by: ["customerId"],
    _sum: { totalAmount: true },
  });
  const payments = await prisma.customerPayment.groupBy({
    by: ["customerId"],
    _sum: { amount: true },
  });

  const net = new Map<string, Prisma.Decimal>();
  for (const group of sales) {
    net.set(
      group.customerId,
      (net.get(group.customerId) ?? ZERO).add(sumOrZero(group._sum?.totalAmount))
    );
  }
  for (const group of payments) {
    net.set(
      group.customerId,
      (net.get(group.customerId) ?? ZERO).sub(sumOrZero(group._sum?.amount))
    );
  }

  let total = ZERO;
  net.forEach((outstanding) => {
    if (outstanding.greaterThan(0)) total = total.add(outstanding);
  });
  return total;
}

// ---------------------------------------------------------------------------
// The running-balance timeline
// ---------------------------------------------------------------------------

export type LedgerEntry = {
  id: string;
  kind: "sale" | "payment";
  /**
   * `"unified"` on a sale, null on a payment.
   *
   * Every sale is a unified bill since S9, and the union keeps the single
   * member deliberately: a bill may hold beverage, bakery and milk lines at
   * once, so there is no one module to name it by. `label` names the shops it
   * actually drew from instead.
   */
  module: "unified" | null;
  date: Date;
  /** Positive for a sale (increases debt), negative for a payment. */
  amount: Prisma.Decimal;
  /** Outstanding AFTER this entry — the whole point of the timeline. */
  runningBalance: Prisma.Decimal;
  label: string;
  itemCount: number | null;
};

/** Everything one customer has done, fetched once. */
export type CustomerActivity = Awaited<ReturnType<typeof getCustomerActivity>>;

/**
 * All of a customer's sales and payments, in TWO SEQUENTIAL queries.
 *
 * It was four plus a JS de-duplication pass until S9. Every bill lived in one of
 * four tables, and the unified copies of the legacy rows had to be filtered out
 * using the legacy ids as the exclusion list — a JS twin of the SQL guard the
 * balance paths used, and the two disagreeing once made the profile list the
 * same milk sale twice. `Sale` is now the only sale table, so both the extra
 * queries and the whole class of bug are gone.
 *
 * ---------------------------------------------------------------------------
 * WHY SEQUENTIAL, NOT Promise.all
 * ---------------------------------------------------------------------------
 * The pooled Supabase URL runs with `connection_limit=1` (see the env contract
 * in CLAUDE.md), and Vercel's serverless functions are configured the same way.
 * A `Promise.all` of a dozen queries therefore does NOT run in parallel — one
 * executes and the rest queue for the single connection, and the ones at the
 * back exceed the 10s pool timeout and throw:
 *
 *   "Timed out fetching a new connection from the connection pool
 *    (Current connection pool timeout: 10, connection limit: 1)"
 *
 * Found the hard way: the profile route fanned out 12 concurrent queries and
 * failed outright in the browser while type-checking perfectly. Awaiting in
 * series costs nothing real — with one connection there was never any
 * parallelism to lose — and it cannot time out waiting for itself.
 *
 * The rows are fetched ONCE here and reused for both the purchases list and the
 * ledger, rather than each fetching its own copy.
 */
export async function getCustomerActivity(customerId: string) {
  const where = { customerId };

  const sales = await prisma.sale.findMany({
    where,
    select: {
      id: true,
      saleDate: true,
      totalAmount: true,
      notes: true,
      createdAt: true,
      _count: { select: { items: true } },
      // moduleKey only — a ledger row says WHICH shops the bill touched. No
      // money is read off the lines; the bill's stored totalAmount is the
      // authority, exactly as for every other row here.
      items: { select: { moduleKey: true } },
    },
  });

  const payments = await prisma.customerPayment.findMany({
    where,
    select: {
      id: true,
      paymentDate: true,
      amount: true,
      method: true,
      notes: true,
      createdAt: true,
    },
  });

  return { sales, payments };
}

/** "Beverages · Milk" — which shops one unified bill drew from, in fixed order. */
export function unifiedSaleModules(items: { moduleKey: string }[]): string[] {
  const order = ["beverages", "bakery", "milk"];
  const present = new Set(items.map((item) => item.moduleKey));
  return [
    ...order.filter((key) => present.has(key)),
    ...Array.from(present).filter((key) => !order.includes(key)).sort(),
  ];
}

const MODULE_WORD: Record<string, string> = {
  beverages: "Beverages",
  bakery: "Bakery",
  milk: "Milk",
};

/** The ledger/purchase label for a unified bill: "Sale · Beverages · Milk". */
export function unifiedSaleLabel(items: { moduleKey: string }[]): string {
  const modules = unifiedSaleModules(items).map((key) => MODULE_WORD[key] ?? key);
  return modules.length > 0 ? `Sale · ${modules.join(" · ")}` : "Sale";
}

/**
 * Balance derived from already-loaded rows.
 *
 * Same arithmetic as {@link getCustomerBalance}, which aggregates in the
 * database. Two paths exist for one reason: the LIST must not load rows (there
 * may be thousands), while a PROFILE has already loaded them for its timeline
 * and re-querying would be four wasted round trips on a one-connection pool.
 *
 * They must agree exactly, and the verification pass checks that they do by
 * comparing this against the /balance endpoint for the same customer.
 */
export function summariseActivity(activity: CustomerActivity): CustomerBalance {
  let totalBilled = ZERO;
  let lastSaleDate: Date | null = null;

  for (const sale of activity.sales) {
    totalBilled = totalBilled.add(sale.totalAmount);
    lastSaleDate = laterOf(lastSaleDate, sale.saleDate);
  }

  let totalPaid = ZERO;
  let lastPaymentDate: Date | null = null;
  for (const payment of activity.payments) {
    totalPaid = totalPaid.add(payment.amount);
    lastPaymentDate = laterOf(lastPaymentDate, payment.paymentDate);
  }

  return {
    totalBilled,
    totalPaid,
    outstanding: totalBilled.sub(totalPaid),
    lastSaleDate,
    lastPaymentDate,
  };
}

/**
 * Every sale and payment in date order, each carrying the running outstanding
 * balance after it.
 *
 * Ordered by date, then by createdAt as a tiebreak so two entries on the same
 * day have a stable, reproducible order — otherwise the running balance column
 * could reshuffle between reloads.
 */
export function buildLedger(activity: CustomerActivity): LedgerEntry[] {
  const { sales, payments } = activity;

  type Unsorted = Omit<LedgerEntry, "runningBalance"> & { createdAt: Date };

  const entries: Unsorted[] = [
    ...sales.map((sale) => ({
      id: sale.id,
      kind: "sale" as const,
      module: "unified" as const,
      date: sale.saleDate,
      amount: sale.totalAmount,
      label: unifiedSaleLabel(sale.items),
      itemCount: sale._count.items,
      createdAt: sale.createdAt,
    })),
    ...payments.map((payment) => ({
      id: payment.id,
      kind: "payment" as const,
      module: null,
      date: payment.paymentDate,
      // Negative: a payment REDUCES what is outstanding. Storing the sign here
      // means the running total is a plain sum and can't get the direction
      // wrong further down.
      amount: payment.amount.negated(),
      label: payment.method ? `Payment · ${payment.method}` : "Payment",
      itemCount: null,
      createdAt: payment.createdAt,
    })),
  ];

  entries.sort((a, b) => {
    const byDate = a.date.getTime() - b.date.getTime();
    if (byDate !== 0) return byDate;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  let running = ZERO;
  return entries.map((entry) => {
    running = running.add(entry.amount);
    // createdAt was only needed for the tiebreak above; it isn't part of the
    // ledger contract.
    const { createdAt, ...rest } = entry;
    void createdAt;
    return { ...rest, runningBalance: running };
  });
}

/** Convenience for callers that want only the ledger and haven't loaded rows. */
export async function getCustomerLedger(
  customerId: string
): Promise<LedgerEntry[]> {
  return buildLedger(await getCustomerActivity(customerId));
}
