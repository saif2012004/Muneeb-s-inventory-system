import { Prisma } from "@prisma/client";

/**
 * Milk SHOP SALES — milk the owner SELLS to hotels, shops and individuals.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE FILE FROM lib/milk.ts
 * ---------------------------------------------------------------------------
 * `lib/milk.ts` is the FARMER side: milk bought FROM farmers, feed and cash
 * advanced to them, and the two-way running balance that results. That is the
 * one place in this app where real owing lives, and it is the most delicate
 * money in the project.
 *
 * This file is the opposite direction — an outbound sale to a customer, paid on
 * the spot, no balance carried. The two were only ever neighbours in one file;
 * they share no helper, no table and no arithmetic.
 *
 * They were split (2026-08-12) because the unified checkout is going to absorb
 * the milk SHOP sale, and that work must be incapable of reaching farmer
 * balances by accident. The boundary is now a file boundary rather than a
 * comment: **nothing here may import from `lib/milk.ts`, and nothing there may
 * import from here.**
 *
 * Verified at the time of the split: neither export below touches
 * `MilkDelivery`, `FarmerPurchase` or `Farmer`, makes any database call, or
 * uses any of `lib/milk.ts`'s module-level helpers (`ZERO`, `sumOrZero`,
 * `laterOf`). Both moved unchanged — this was a relocation, not a rewrite.
 */

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
