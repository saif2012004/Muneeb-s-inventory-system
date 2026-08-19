/**
 * THE FARMER STATEMENT — one farmer's milk and purchases over a date range,
 * shaped for a spreadsheet the owner hands over or files. Server only.
 *
 * ---------------------------------------------------------------------------
 * 🔴 A PERIOD STATEMENT IS NOT A RUNNING BALANCE
 * ---------------------------------------------------------------------------
 * Everything below is scoped to the requested window. If the range starts partway
 * through a farmer's history, `netForPeriod` is what happened IN THOSE DATES —
 * NOT what is owed overall. Those two numbers can differ by any amount, and a
 * farmer reading "you are owed Rs. 5,000" on a statement has no way to tell which
 * one it is.
 *
 * So the statement carries BOTH, labelled: the period net, and
 * `allTimeNetBalance` from `getFarmerBalance()` — the same figure the balance
 * sheet and the farmer profile show, so a statement can never disagree with the
 * screen it was printed from.
 *
 * This is the same trap that kept a date filter OFF the ledger in Phase 6: a
 * running balance filtered to a window is wrong unless it carries an opening
 * balance forward, because the first row starts from zero and every figure under
 * it is understated. A statement avoids it by not claiming to be a ledger.
 *
 * QUERY BUDGET: 4 round trips — farmer, deliveries, purchases, all-time balance
 * (itself 2 aggregates). Awaited in SERIES; see the note in CLAUDE.md.
 */
import { getFarmerBalance, type FarmerBalance } from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { serializeLiters, serializeMoney } from "@/lib/serialize";

export type StatementDelivery = {
  /** ISO-8601 UTC. Format in Karachi at the boundary (Gotcha 4). */
  date: string;
  /**
   * null means that session did NOT happen — never 0.
   *
   * A farmer who skipped the morning is not a farmer who turned up with nothing,
   * and on a document they may be paid from, the difference matters.
   */
  morningLiters: number | null;
  eveningLiters: number | null;
  /** morning + evening, as the owner asked for it: the collective figure. */
  totalLiters: number;
  ratePerLiter: number;
  /** totalLiters × ratePerLiter, stored at delivery time — never recomputed. */
  amount: number;
  notes: string | null;
};

export type StatementPurchase = {
  date: string;
  /**
   * What they took. `isCash` is a DISPLAY hint for the "or write cash if that
   * was given as cash" rule — the underlying `itemDescription` is untouched, so
   * a farmer's own wording ("cash for eid") still reaches the page.
   */
  item: string;
  isCash: boolean;
  amount: number;
  notes: string | null;
};

export type FarmerStatement = {
  farmer: { id: string; name: string; phone: string | null; isActive: boolean };
  period: { from: string | null; to: string | null };
  deliveries: StatementDelivery[];
  purchases: StatementPurchase[];
  totals: {
    /** Litres and value for the WINDOW only. */
    litres: number;
    milkValue: number;
    purchases: number;
    /** milkValue − purchases, for the window. Positive = the owner owes. */
    netForPeriod: number;
  };
  /** The whole relationship, unscoped. See the docblock — both are shown. */
  allTimeNetBalance: number;
};

/**
 * Is this purchase money rather than goods?
 *
 * Matched on the description because that is where it lives — there is no
 * `type` column on FarmerPurchase, and adding one would be a migration for a
 * label. Deliberately generous: the owner types this freehand, and "Cash",
 * "cash 5000" and "CASH" are all the same thing to him.
 */
export function isCashPurchase(itemDescription: string): boolean {
  return /\bcash\b/i.test(itemDescription.trim());
}

export async function getFarmerStatement(
  farmerId: string,
  window: { gte: Date; lt: Date } | undefined
): Promise<FarmerStatement | null> {
  const farmer = await prisma.farmer.findUnique({
    where: { id: farmerId },
    select: { id: true, name: true, phone: true, isActive: true },
  });
  if (!farmer) return null;

  // Sorted by DATE, as asked. `createdAt` breaks ties so two entries on one day
  // keep a stable order between downloads — otherwise the same statement
  // reprinted could list them the other way round.
  const deliveries = await prisma.milkDelivery.findMany({
    where: { farmerId, ...(window ? { deliveryDate: window } : {}) },
    orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }],
    select: {
      deliveryDate: true,
      morningLiters: true,
      eveningLiters: true,
      totalLiters: true,
      ratePerLiter: true,
      totalAmount: true,
      notes: true,
    },
  });

  const purchases = await prisma.farmerPurchase.findMany({
    where: { farmerId, ...(window ? { purchaseDate: window } : {}) },
    orderBy: [{ purchaseDate: "asc" }, { createdAt: "asc" }],
    select: {
      purchaseDate: true,
      itemDescription: true,
      amount: true,
      notes: true,
    },
  });

  const allTime: FarmerBalance = await getFarmerBalance(farmerId);

  const rows: StatementDelivery[] = deliveries.map((d) => ({
    date: d.deliveryDate.toISOString(),
    morningLiters: serializeLiters(d.morningLiters),
    eveningLiters: serializeLiters(d.eveningLiters),
    totalLiters: serializeMoney(d.totalLiters),
    ratePerLiter: serializeMoney(d.ratePerLiter),
    // The STORED amount, not litres × rate recomputed here. The rate can be
    // edited on a delivery; the money that was agreed is what is on the record.
    amount: serializeMoney(d.totalAmount),
    notes: d.notes,
  }));

  const purchaseRows: StatementPurchase[] = purchases.map((p) => ({
    date: p.purchaseDate.toISOString(),
    item: p.itemDescription,
    isCash: isCashPurchase(p.itemDescription),
    amount: serializeMoney(p.amount),
    notes: p.notes,
  }));

  // Summed as numbers only AFTER each value crossed the Decimal boundary above
  // (Gotcha 2). Rounded at the end so a long statement cannot drift a paisa.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const litres = round2(rows.reduce((t, r) => t + r.totalLiters, 0));
  const milkValue = round2(rows.reduce((t, r) => t + r.amount, 0));
  const purchasesTotal = round2(purchaseRows.reduce((t, r) => t + r.amount, 0));

  return {
    farmer,
    period: {
      from: window ? window.gte.toISOString() : null,
      to: window ? window.lt.toISOString() : null,
    },
    deliveries: rows,
    purchases: purchaseRows,
    totals: {
      litres,
      milkValue,
      purchases: purchasesTotal,
      netForPeriod: round2(milkValue - purchasesTotal),
    },
    allTimeNetBalance: serializeMoney(allTime.netBalanceOwed),
  };
}
