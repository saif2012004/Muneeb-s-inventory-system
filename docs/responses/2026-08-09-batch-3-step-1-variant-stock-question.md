Stop on the StockItem approach — the plan changed after that prompt went out, and your analysis,
while good, is now moot. Decision since: we're DELETING the 48 discount variants entirely and making
discount a SALE-TIME field, not sharing stock across variants. Once variants are gone, every product
is one real SKU and stock becomes a plain per-row integer with no StockItem table needed. So:

1. Do NOT build StockItem or any shared-stock plumbing. Stock is DEFERRED — it comes AFTER the
   discount rework, and it'll be trivial then (one integer per product).

2. Do the DISCOUNT REWORK first (this is now the prerequisite). Follow the discount-rework spec:
   - Delete the ~48 seeded discount-variant products; keep only the base products.
   - Discount becomes a sale-time PERCENTAGE field, per-line AND an optional whole-bill %, stacking
     line-first-then-bill-on-subtotal, 2-decimal rounding, snapshotted on the sale.
   - Update seed.ts so a re-seed makes only base products.

3. USE what you just found: the DB has 63 products, not 62 — "Big Apple 0.5L" was created in-app
   (real data, not seed). So the variant-delete must target the SPECIFIC seeded variant ids, NOT a
   blanket "discountPercent > 0" rule, and must LEAVE owner-created products (Big Apple 0.5L) and all
   base products untouched. Show me the exact id list it will delete and confirm 0 sale lines
   reference any of them, BEFORE running anything.

MIGRATION IS A HARD STOP: show me the schema change, the generated migration SQL, and the pre-delete
safety check (0 sale-line references + the exact delete list) and WAIT for my go before running
prisma migrate or any delete. This deletes catalog rows from the live DB with Saif's real data in it.