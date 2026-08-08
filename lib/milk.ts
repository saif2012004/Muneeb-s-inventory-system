import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * THE FARMER NET-BALANCE CALCULATION. One implementation, the way
 * `reconcileSaleLines()` is the price snapshot and `lib/receivables.ts` is the
 * customer balance.
 *
 *   totalMilkValue = SUM(MilkDelivery.totalAmount)   — milk bought from them
 *   totalPurchases = SUM(FarmerPurchase.amount)      — goods they took
 *   netBalanceOwed = totalMilkValue − totalPurchases
 *
 * The farmers list, the farmer profile, Phase 6's balance sheet and any later
 * report all call in here. If each did its own arithmetic they would eventually
 * disagree, and a ledger that disagrees with itself is worse than no ledger.
 *
 * ---------------------------------------------------------------------------
 * THE SIGN IS THE OPPOSITE WAY ROUND FROM CUSTOMERS. READ THIS.
 * ---------------------------------------------------------------------------
 * Customers: positive outstanding = the customer owes the OWNER  → rose (debt).
 * Farmers:   positive net balance = the OWNER owes the FARMER    → emerald.
 *
 * Both are "positive", both are money, and they point in opposite directions.
 * Copying the customer colour logic across would paint every unpaid farmer as
 * if the farmer were in debt — which is backwards, and backwards in the
 * direction that makes the owner think they have been paid when they have not.
 * `farmerBalanceTone()` below is the ONLY place this mapping is decided; use it
 * rather than testing the sign at a call site.
 *
 * ---------------------------------------------------------------------------
 * PRISMA BEHAVIOURS THIS MUST SURVIVE (v6, confirmed against the docs)
 * ---------------------------------------------------------------------------
 * 1. `_sum` returns NULL, not 0, when no rows match.
 * 2. `groupBy` omits a group ENTIRELY when it has no rows — a farmer who has
 *    never delivered simply does not appear in the result set.
 *
 * A farmer with no deliveries and no purchases is an ordinary farmer who is
 * owed nothing; they must read as 0, never null, NaN or an error.
 *
 * All money math stays on Decimal. Serialization to `number` happens once, at
 * the route boundary (Gotcha 2).
 */

const ZERO = new Prisma.Decimal(0);

// ---------------------------------------------------------------------------
// Row shapes
//
// These live here, not in the route files. A Next.js `route.ts` may only export
// handlers and the runtime/dynamic config — any other named export fails the
// build-time route type check. They are shared by the list, create, edit and
// quick-entry routes so a column can never be returned by one and missed by
// another.
// ---------------------------------------------------------------------------

export const DELIVERY_SELECT = {
  id: true,
  farmerId: true,
  deliveryDate: true,
  morningLiters: true,
  eveningLiters: true,
  ratePerLiter: true,
  totalLiters: true,
  totalAmount: true,
  notes: true,
  createdAt: true,
} as const;

export const PURCHASE_SELECT = {
  id: true,
  farmerId: true,
  purchaseDate: true,
  itemDescription: true,
  amount: true,
  notes: true,
  createdAt: true,
} as const;

export const MILK_SALE_SELECT = {
  id: true,
  customerId: true,
  saleDate: true,
  liters: true,
  ratePerLiter: true,
  totalAmount: true,
  notes: true,
  createdAt: true,
  customer: { select: { id: true, name: true, type: true } },
} as const;

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
// Delivery totals
// ---------------------------------------------------------------------------

/**
 * `totalLiters` and `totalAmount` are STORED columns, so create, update and
 * quick entry all have to write them — and all three must agree. Computed here,
 * once, on Decimal.
 *
 * Doing this in JS floats would be the classic 12.3 + 4.1 = 16.400000000000002
 * bug, which then multiplies by the rate and lands a few paise off in a column
 * the owner reconciles by hand.
 *
 * A missing session contributes 0 to the total while STAYING null in its own
 * column — "no evening delivery" and "an evening delivery of 0 L" are different
 * facts, and only the second should ever display as a zero.
 */
export function computeDeliveryTotals(
  morningLiters: number | null | undefined,
  eveningLiters: number | null | undefined,
  ratePerLiter: number
): {
  morningLiters: Prisma.Decimal | null;
  eveningLiters: Prisma.Decimal | null;
  ratePerLiter: Prisma.Decimal;
  totalLiters: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
} {
  const morning =
    morningLiters === null || morningLiters === undefined
      ? null
      : new Prisma.Decimal(morningLiters);
  const evening =
    eveningLiters === null || eveningLiters === undefined
      ? null
      : new Prisma.Decimal(eveningLiters);

  const rate = new Prisma.Decimal(ratePerLiter);
  const totalLiters = (morning ?? ZERO).add(evening ?? ZERO);

  return {
    morningLiters: morning,
    eveningLiters: evening,
    ratePerLiter: rate,
    totalLiters,
    totalAmount: totalLiters.mul(rate),
  };
}

/**
 * A milk SALE's total. `liters × ratePerLiter`, on Decimal.
 *
 * Trivial arithmetic, deliberately not inlined at the call site: it is the one
 * number the owner reconciles by hand, three routes write it (create, edit and
 * any future import), and doing it in JS floats would land it a few paise off.
 * `totalAmount` is a stored column and is NEVER accepted from the client.
 */
export function computeMilkSaleTotal(
  liters: number,
  ratePerLiter: number
): Prisma.Decimal {
  return new Prisma.Decimal(liters).mul(new Prisma.Decimal(ratePerLiter));
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export type FarmerBalance = {
  /** SUM of every delivery's totalAmount — what the owner owes for milk. */
  totalMilkValue: Prisma.Decimal;
  /** SUM of every purchase — goods the farmer took, offsetting the above. */
  totalPurchases: Prisma.Decimal;
  /** milkValue − purchases. POSITIVE = the owner owes the farmer. */
  netBalanceOwed: Prisma.Decimal;
  /** Litres delivered, all time. Not money — shown alongside it. */
  totalLiters: Prisma.Decimal;
  lastDeliveryDate: Date | null;
  lastPurchaseDate: Date | null;
};

/**
 * How a farmer balance reads to the owner.
 *
 * "advance" is a real state, not an error: the farmer has taken more in goods
 * than their milk is worth so far, so they are running ahead and the owner is
 * effectively owed. Naming it keeps the meaning explicit instead of showing a
 * bare minus sign in a column headed "owed".
 */
export type FarmerBalanceTone = "owed" | "settled" | "advance";

export function farmerBalanceTone(netBalanceOwed: number): FarmerBalanceTone {
  if (netBalanceOwed > 0) return "owed";
  if (netBalanceOwed < 0) return "advance";
  return "settled";
}

/**
 * Balance for one farmer. Two aggregates, awaited IN SERIES — no delivery rows
 * are transferred.
 *
 * Sequential, not `Promise.all`: with `connection_limit=1` a fan-out does not
 * run in parallel, it queues behind the single connection and the queries at
 * the back can exceed the 10s pool timeout. See `getFarmerActivity` for the
 * full account.
 */
export async function getFarmerBalance(farmerId: string): Promise<FarmerBalance> {
  const where = { farmerId };

  const deliveries = await prisma.milkDelivery.aggregate({
    where,
    _sum: { totalAmount: true, totalLiters: true },
    _max: { deliveryDate: true },
  });
  const purchases = await prisma.farmerPurchase.aggregate({
    where,
    _sum: { amount: true },
    _max: { purchaseDate: true },
  });

  const totalMilkValue = sumOrZero(deliveries._sum.totalAmount);
  const totalPurchases = sumOrZero(purchases._sum.amount);

  return {
    totalMilkValue,
    totalPurchases,
    netBalanceOwed: totalMilkValue.sub(totalPurchases),
    totalLiters: sumOrZero(deliveries._sum.totalLiters),
    lastDeliveryDate: deliveries._max.deliveryDate,
    lastPurchaseDate: purchases._max.purchaseDate,
  };
}

/**
 * Balances for many farmers in a FIXED two queries, however many farmers there
 * are. The alternative — a balance query per farmer — is the N+1 that Phase 6's
 * all-farmers balance sheet would otherwise walk straight into.
 *
 * Every requested id is present in the result, so callers never handle a
 * missing entry. A farmer with no activity gets a genuine zero rather than
 * being absent (see the `groupBy` note at the top).
 */
export async function getFarmerBalances(
  farmerIds: string[]
): Promise<Map<string, FarmerBalance>> {
  const balances = new Map<string, FarmerBalance>();
  if (farmerIds.length === 0) return balances;

  // Seed every requested id with zero FIRST: groupBy returns nothing at all for
  // a farmer with no rows, so without this a brand-new farmer would be missing
  // from the map and read as undefined downstream.
  for (const id of farmerIds) {
    balances.set(id, {
      totalMilkValue: ZERO,
      totalPurchases: ZERO,
      netBalanceOwed: ZERO,
      totalLiters: ZERO,
      lastDeliveryDate: null,
      lastPurchaseDate: null,
    });
  }

  const where = { farmerId: { in: farmerIds } };

  const deliveries = await prisma.milkDelivery.groupBy({
    by: ["farmerId"],
    where,
    _sum: { totalAmount: true, totalLiters: true },
    _max: { deliveryDate: true },
  });
  const purchases = await prisma.farmerPurchase.groupBy({
    by: ["farmerId"],
    where,
    _sum: { amount: true },
    _max: { purchaseDate: true },
  });

  for (const group of deliveries) {
    const current = balances.get(group.farmerId);
    if (!current) continue;
    current.totalMilkValue = sumOrZero(group._sum?.totalAmount);
    current.totalLiters = sumOrZero(group._sum?.totalLiters);
    current.lastDeliveryDate = group._max?.deliveryDate ?? null;
  }

  for (const group of purchases) {
    const current = balances.get(group.farmerId);
    if (!current) continue;
    current.totalPurchases = sumOrZero(group._sum?.amount);
    current.lastPurchaseDate = group._max?.purchaseDate ?? null;
  }

  // Derived last, once both sides are accumulated.
  balances.forEach((balance) => {
    balance.netBalanceOwed = balance.totalMilkValue.sub(balance.totalPurchases);
  });

  return balances;
}

/**
 * The whole-business view: what the owner owes across ALL farmers.
 *
 * Deliberately NOT `sum(netBalanceOwed)`. Two farmers, one owed 5,000 and one
 * running 5,000 ahead, would net to zero and read as "nothing to pay" — but the
 * owner still has to hand 5,000 to the first farmer. The debts and the advances
 * are reported separately because they cannot be settled against each other.
 */
export type FarmersSummary = {
  farmerCount: number;
  totalMilkValue: Prisma.Decimal;
  totalPurchases: Prisma.Decimal;
  totalLiters: Prisma.Decimal;
  /** Sum of balances that are positive — cash the owner must actually find. */
  totalOwedToFarmers: Prisma.Decimal;
  /** Sum of the negative balances, as a positive number. */
  totalAdvanced: Prisma.Decimal;
};

export function summariseFarmerBalances(
  balances: FarmerBalance[]
): FarmersSummary {
  const summary: FarmersSummary = {
    farmerCount: 0,
    totalMilkValue: ZERO,
    totalPurchases: ZERO,
    totalLiters: ZERO,
    totalOwedToFarmers: ZERO,
    totalAdvanced: ZERO,
  };

  for (const balance of balances) {
    summary.farmerCount += 1;
    summary.totalMilkValue = summary.totalMilkValue.add(balance.totalMilkValue);
    summary.totalPurchases = summary.totalPurchases.add(balance.totalPurchases);
    summary.totalLiters = summary.totalLiters.add(balance.totalLiters);

    if (balance.netBalanceOwed.greaterThan(0)) {
      summary.totalOwedToFarmers = summary.totalOwedToFarmers.add(
        balance.netBalanceOwed
      );
    } else if (balance.netBalanceOwed.lessThan(0)) {
      summary.totalAdvanced = summary.totalAdvanced.add(
        balance.netBalanceOwed.negated()
      );
    }
  }

  return summary;
}

/**
 * The owed/advanced split across EVERY farmer, in two queries and without
 * listing farmers first.
 *
 * Same shape as `summariseFarmerBalances`, and it must stay in step with it:
 * debts and advances are accumulated separately and never netted, and a farmer
 * with no rows contributes nothing to either, so there is no need to enumerate
 * farmers before aggregating.
 *
 * Exists because the reports summary only needs the two totals, and going via
 * `getFarmerBalances` would cost an extra query building a per-farmer map that
 * is then thrown away — which matters when a single round trip to the database
 * costs about a second.
 */
export async function getAllFarmerTotals(): Promise<{
  totalOwed: Prisma.Decimal;
  totalAdvanced: Prisma.Decimal;
}> {
  const deliveries = await prisma.milkDelivery.groupBy({
    by: ["farmerId"],
    _sum: { totalAmount: true },
  });
  const purchases = await prisma.farmerPurchase.groupBy({
    by: ["farmerId"],
    _sum: { amount: true },
  });

  const net = new Map<string, Prisma.Decimal>();
  for (const group of deliveries) {
    net.set(
      group.farmerId,
      (net.get(group.farmerId) ?? ZERO).add(sumOrZero(group._sum?.totalAmount))
    );
  }
  for (const group of purchases) {
    net.set(
      group.farmerId,
      (net.get(group.farmerId) ?? ZERO).sub(sumOrZero(group._sum?.amount))
    );
  }

  let totalOwed = ZERO;
  let totalAdvanced = ZERO;
  net.forEach((balance) => {
    if (balance.greaterThan(0)) totalOwed = totalOwed.add(balance);
    else if (balance.lessThan(0)) totalAdvanced = totalAdvanced.add(balance.negated());
  });

  return { totalOwed, totalAdvanced };
}

// ---------------------------------------------------------------------------
// The running-balance timeline
// ---------------------------------------------------------------------------

export type FarmerLedgerEntry = {
  id: string;
  kind: "delivery" | "purchase";
  date: Date;
  /** Positive for a delivery (owner owes more), negative for a purchase. */
  amount: Prisma.Decimal;
  /** Net owed AFTER this entry — the whole point of the timeline. */
  runningBalance: Prisma.Decimal;
  label: string;
  /** Litres on a delivery row; null on a purchase. */
  liters: Prisma.Decimal | null;
};

export type FarmerActivity = Awaited<ReturnType<typeof getFarmerActivity>>;

/**
 * Everything one farmer has done, in TWO SEQUENTIAL queries, fetched ONCE and
 * reused for the balance, the deliveries table, the purchases table and the
 * ledger.
 *
 * ---------------------------------------------------------------------------
 * WHY SEQUENTIAL, NOT Promise.all
 * ---------------------------------------------------------------------------
 * The pooled Supabase URL runs `connection_limit=1`, on Vercel as well as
 * locally. A `Promise.all` of queries therefore does NOT run in parallel — one
 * executes and the rest queue for the single connection, and the ones at the
 * back exceed the 10s pool timeout and throw:
 *
 *   "Timed out fetching a new connection from the connection pool
 *    (Current connection pool timeout: 10, connection limit: 1)"
 *
 * That is not hypothetical: the Phase 4b customer profile fanned out 12
 * concurrent queries and failed outright in the browser while type-checking and
 * linting perfectly. Awaiting in series costs nothing real — with one
 * connection there was never any parallelism to lose.
 */
export async function getFarmerActivity(farmerId: string) {
  const where = { farmerId };

  const deliveries = await prisma.milkDelivery.findMany({
    where,
    select: {
      id: true,
      deliveryDate: true,
      morningLiters: true,
      eveningLiters: true,
      ratePerLiter: true,
      totalLiters: true,
      totalAmount: true,
      notes: true,
      createdAt: true,
    },
    orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
  });

  const purchases = await prisma.farmerPurchase.findMany({
    where,
    select: {
      id: true,
      purchaseDate: true,
      itemDescription: true,
      amount: true,
      notes: true,
      createdAt: true,
    },
    orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
  });

  return { deliveries, purchases };
}

/**
 * Balance derived from already-loaded rows.
 *
 * Same arithmetic as {@link getFarmerBalance}, which aggregates in the database.
 * Two paths exist for one reason: the LIST must not load rows (there may be
 * thousands), while a PROFILE has already loaded them for its tables and
 * re-querying would be wasted round trips on a one-connection pool.
 *
 * They must agree exactly. The verification pass checks that by comparing this
 * against the balance endpoint for the same farmer.
 */
export function summariseFarmerActivity(activity: FarmerActivity): FarmerBalance {
  let totalMilkValue = ZERO;
  let totalLiters = ZERO;
  let lastDeliveryDate: Date | null = null;

  for (const delivery of activity.deliveries) {
    totalMilkValue = totalMilkValue.add(delivery.totalAmount);
    totalLiters = totalLiters.add(delivery.totalLiters);
    lastDeliveryDate = laterOf(lastDeliveryDate, delivery.deliveryDate);
  }

  let totalPurchases = ZERO;
  let lastPurchaseDate: Date | null = null;

  for (const purchase of activity.purchases) {
    totalPurchases = totalPurchases.add(purchase.amount);
    lastPurchaseDate = laterOf(lastPurchaseDate, purchase.purchaseDate);
  }

  return {
    totalMilkValue,
    totalPurchases,
    netBalanceOwed: totalMilkValue.sub(totalPurchases),
    totalLiters,
    lastDeliveryDate,
    lastPurchaseDate,
  };
}

/**
 * Every delivery and purchase in date order, each carrying the net balance
 * after it.
 *
 * Ordered by date then `createdAt`, so two entries on the same day have a
 * stable order — otherwise the running-balance column would reshuffle between
 * reloads and look like the data had changed.
 */
export function buildFarmerLedger(activity: FarmerActivity): FarmerLedgerEntry[] {
  type Unsorted = Omit<FarmerLedgerEntry, "runningBalance"> & { createdAt: Date };

  const entries: Unsorted[] = [
    ...activity.deliveries.map((delivery) => ({
      id: delivery.id,
      kind: "delivery" as const,
      date: delivery.deliveryDate,
      amount: delivery.totalAmount,
      label: `Milk · ${delivery.totalLiters.toString()} L × ${delivery.ratePerLiter.toString()}`,
      liters: delivery.totalLiters,
      createdAt: delivery.createdAt,
    })),
    ...activity.purchases.map((purchase) => ({
      id: purchase.id,
      kind: "purchase" as const,
      date: purchase.purchaseDate,
      // Negative: goods taken REDUCE what the owner owes. Storing the sign here
      // means the running total is a plain sum and cannot get the direction
      // wrong further down.
      amount: purchase.amount.negated(),
      label: purchase.itemDescription,
      liters: null,
      createdAt: purchase.createdAt,
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
    // createdAt was only needed for the tiebreak; it is not part of the
    // ledger contract.
    const { createdAt, ...rest } = entry;
    void createdAt;
    return { ...rest, runningBalance: running };
  });
}
