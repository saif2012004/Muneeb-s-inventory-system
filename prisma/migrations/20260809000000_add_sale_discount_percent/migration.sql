-- Discount becomes a SALE-TIME field.
--
-- Until now a discount was a separate Product row ("Pepsi 1.5L (30% off)"), which meant the
-- catalog carried 36 variant rows for 12 physical drinks and a discount could only ever be one
-- of 20/30/60%. Discount is now entered on the sale itself, at two levels: per LINE and an
-- optional whole-bill percentage.
--
-- NOT NULL DEFAULT 0, deliberately, rather than nullable. A null discount and a 0% discount
-- mean the same thing, and this project has already been bitten by that exact ambiguity once —
-- see docs/phase-4-bakery-module.md, where Product.discountPercent being 0 rather than null
-- broke a falsy check and printed "0% off" on every bakery row. Non-null makes the arithmetic
-- total: every line is `x (1 - d/100)` with no branch and no null handling.
--
-- DECIMAL(5,2) rather than INTEGER so a 7.5% discount is expressible, and so the percentage
-- stays on Prisma.Decimal end to end. A percentage held as a float is how rounding drifts
-- (Gotcha 2) — the stacking maths rounds to 2dp after the line discount and again after the
-- bill discount, and both of those need exact arithmetic.
--
-- Additive and safe on existing rows: every sale already recorded takes 0 in both columns,
-- which is exactly what it was charged.
--
-- NOTE: the 36 variant Product rows are deleted by a separate one-off script, NOT by this
-- migration. That delete only applies to the existing development database; a fresh environment
-- seeds from the updated prisma/seed.ts, which never creates variants in the first place.

-- AlterTable
ALTER TABLE "BeverageSale" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BeverageSaleItem" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BakerySale" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BakerySaleItem" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
