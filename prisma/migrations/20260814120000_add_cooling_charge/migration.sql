-- Migration E — cooling / chilling charge (CHECKLIST #17).
--
-- ADDITIVE ONLY. Two columns, no data rewritten, nothing dropped, no constraint
-- or index touched. Every existing row is unaffected: the 28 products get NULL
-- ("never chilled", so no toggle appears for them until the owner sets a
-- charge), and both existing SaleItem rows get 0, leaving every stored total
-- exactly as it was.
--
-- Product.coolingCharge is NULLABLE on purpose. NULL = never chilled;
-- 0 = chilled at no charge. Collapsing them would put a chill toggle on buns.
--
-- SaleItem.coolingRate is NOT NULL DEFAULT 0 because a line either carries a
-- charge or does not — there is no "unknown" — and the default makes the
-- migration lossless for the rows written before cooling existed.

ALTER TABLE "Product"  ADD COLUMN "coolingCharge" numeric(10,2);
ALTER TABLE "SaleItem" ADD COLUMN "coolingRate"   numeric(10,2) NOT NULL DEFAULT 0;
