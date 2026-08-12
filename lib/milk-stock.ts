import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { applyStockDeltas } from "@/lib/sales";

/**
 * THE DELIVERY-TO-STOCK BRIDGE — milk bought from farmers becomes sellable
 * catalog stock.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE AND NOT PART OF lib/milk.ts
 * ---------------------------------------------------------------------------
 * `lib/milk.ts` is the FARMER side: deliveries, purchases, balances, the
 * ledger. It contains **zero** references to `product` or `stock`, and that is a
 * property worth keeping rather than an accident — it is what makes "the bridge
 * cannot change a farmer's money" checkable with:
 *
 *     grep -c "product\|stock" lib/milk.ts     ->     0
 *
 * If this code lived there, that grep would stop meaning anything. The same
 * reasoning split `lib/milk-sales.ts` out in S2.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE BRIDGE IS, AND IS NOT
 * ---------------------------------------------------------------------------
 * It is STOCK-ONLY. Recording, editing or deleting a delivery moves exactly one
 * column — `Product.stock` on the milk product. It never reads or writes a
 * farmer figure: not `totalAmount`, not a purchase, not a balance. A delivery's
 * litres and value are computed by `computeDeliveryTotals` exactly as before,
 * and the bridge only *reads* the resulting litres.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ MILK STOCK IS NOT AUTHORITATIVE YET
 * ---------------------------------------------------------------------------
 * Deliveries ADD stock and unified `/api/sales` lines SUBTRACT it, but the
 * screen the owner actually uses today — `/milk/sales`, backed by
 * `POST /api/milk/sales` — does NOT decrement: `MilkSale` has no product FK and
 * no items table. Until milk selling moves onto `/api/sales` (S4), the milk
 * stock figure will read HIGH. Known and written down, deliberately, rather
 * than silently trusted. See CLAUDE.md.
 */

/**
 * The single milk product. One product, sold by the litre.
 *
 * Deterministic id from `prisma/seed.ts`, matching how every other seeded
 * product is addressed.
 */
export const MILK_PRODUCT_ID = "prod_milk";

/**
 * The milk product's id, or null when the catalog has no milk product.
 *
 * Null is a real, handled state — not an error. Callers MUST record the
 * delivery anyway and skip the stock step: **a farmer's record must never be
 * blocked by a catalog problem.** The owner handing over milk at 6am is not the
 * moment to refuse a write because a product row is missing.
 */
export async function findMilkProductId(): Promise<string | null> {
  const product = await prisma.product.findUnique({
    where: { id: MILK_PRODUCT_ID },
    select: { id: true },
  });
  return product?.id ?? null;
}

/**
 * Move milk stock by a signed litre delta, inside the caller's transaction.
 *
 * DELEGATES to `applyStockDeltas` rather than issuing its own update, so the
 * "never negative" rule stays ONE implementation — a conditional
 * `UPDATE … WHERE stock >= -delta` enforced by the database, not by a JS check
 * that a concurrent write could slip past. A refused decrement throws
 * `StockConflictError`, which the delivery routes catch and re-word: the stock
 * message ("Stock changed while this sale was being saved") is wrong on both
 * counts when the owner is deleting a delivery.
 *
 * A zero delta is a no-op — `applyStockDeltas` skips it — so an edit that
 * changes only the rate or the notes issues no stock write at all.
 *
 * `deltaLiters` is converted to a number because `StockDeltas` is
 * `Map<string, number>`; litres are Decimal(8,2) so the value is exact.
 */
export async function applyMilkStockDelta(
  tx: Prisma.TransactionClient,
  productId: string,
  deltaLiters: Prisma.Decimal | number
): Promise<void> {
  const delta = Number(deltaLiters);
  if (delta === 0) return;
  await applyStockDeltas(tx, new Map([[productId, delta]]));
}

/**
 * The owner-facing 409 when reversing a delivery would drive milk stock below
 * zero — i.e. some of it has already been sold.
 *
 * Names the fix, because refusing without one would trap the owner: they
 * recorded 250 L in error, sold some, and now cannot correct the record. The
 * escape hatch is the catalog's inline stock editor, which SETS stock outright.
 * If the delivery never happened, the stock was never really there, and
 * correcting it is exactly the action that makes both records true.
 */
export function milkStockReversalMessage(
  liters: Prisma.Decimal | number,
  available: Prisma.Decimal | number
): string {
  return (
    `This delivery's ${Number(liters)} litres can't be taken back out of stock — ` +
    `only ${Number(available)} litres are on hand, so some of it has already been sold. ` +
    `Correct the milk stock in the catalog first, then try again.`
  );
}

/** Current milk stock, for the reversal message. Null when there is no milk product. */
export async function readMilkStock(
  productId: string
): Promise<Prisma.Decimal | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { stock: true },
  });
  return product?.stock ?? null;
}
