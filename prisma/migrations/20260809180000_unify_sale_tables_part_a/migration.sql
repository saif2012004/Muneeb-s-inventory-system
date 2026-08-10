-- UNIFIED CROSS-CATEGORY SALE — Migration A: create, secure, copy. NON-DESTRUCTIVE.
--
-- Merges BeverageSale/BeverageSaleItem and BakerySale/BakerySaleItem into one
-- Sale/SaleItem pair that can hold beverage AND bakery lines on a single bill.
-- Milk is untouched: it has no products and its own tables.
--
-- ---------------------------------------------------------------------------
-- THIS IS HAND-ORDERED. DO NOT REGENERATE IT.
-- ---------------------------------------------------------------------------
-- `prisma migrate diff` produces a correct-looking migration that would DROP
-- the four old tables BEFORE creating the new ones — it sees tables removed
-- from the schema and has no idea the rows should move. Run verbatim, it
-- deletes the only sale in the database. It also omits RLS, which CLAUDE.md
-- requires on every new table (Prisma does not manage RLS, and without it the
-- table is readable through PostgREST with the public anon key).
--
-- So: create, secure, copy, ASSERT. The old tables are deliberately left in
-- place and populated — Migration B drops them, separately, only after the new
-- flow has been verified in a browser. That ordering is the rollback.

-- ---------------------------------------------------------------------------
-- 1. New tables
-- ---------------------------------------------------------------------------

CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    -- "beverages" | "bakery". A SNAPSHOT of what the line was sold as, not a
    -- pointer to what the product's category happens to be today. Deriving it
    -- at report time would re-attribute closed months whenever the owner moves
    -- a product between sub-categories — the same mutable-history problem the
    -- unitPrice and line-discount snapshots already exist to prevent.
    "moduleKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    -- This line's share of the bill AFTER the whole-bill discount.
    --
    -- Per-module revenue is SUM(netLineTotal), never SUM(lineTotal). Line
    -- totals add up to the SUBTOTAL, so summing them per module would overstate
    -- revenue on every bill-discounted sale and break the dashboard's core
    -- claim that beverages + bakery + milk equals total revenue. Apportioned
    -- pro-rata by lineTotal with the rounding residue given to the largest
    -- line, so the parts sum to totalAmount exactly.
    "netLineTotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Sale_customerId_saleDate_idx" ON "Sale"("customerId", "saleDate");
CREATE INDEX "Sale_saleDate_idx" ON "Sale"("saleDate");
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");
-- Reports filter by module on every per-module figure now that the split is
-- line-level rather than table-level.
CREATE INDEX "SaleItem_moduleKey_idx" ON "SaleItem"("moduleKey");

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. RLS — required on every new table (CLAUDE.md, "Database security")
-- ---------------------------------------------------------------------------
-- Enabled with ZERO policies = default deny for anon/authenticated. All app
-- access is Prisma as the `postgres` role, which owns the tables and has
-- rolbypassrls, so this does not affect the app. Do NOT add FORCE ROW LEVEL
-- SECURITY — that would apply RLS to the owner too and break Prisma.
ALTER TABLE "Sale"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Copy the data. ORIGINAL IDS ARE PRESERVED.
-- ---------------------------------------------------------------------------
-- Keeping ids means a migrated sale keeps its identity: nothing that recorded
-- a sale id can dangle, and the before/after rows can be compared directly.

INSERT INTO "Sale" (id, "customerId", "saleDate", "discountPercent", "totalAmount", notes, "createdAt")
SELECT id, "customerId", "saleDate", "discountPercent", "totalAmount", notes, "createdAt"
FROM "BeverageSale";

INSERT INTO "Sale" (id, "customerId", "saleDate", "discountPercent", "totalAmount", notes, "createdAt")
SELECT id, "customerId", "saleDate", "discountPercent", "totalAmount", notes, "createdAt"
FROM "BakerySale";

-- Lines, stamping moduleKey and computing netLineTotal from the sale's bill
-- discount. Every existing sale has a 0.00 bill discount, so netLineTotal
-- equals lineTotal for all migrated rows — but it is COMPUTED rather than
-- assumed, so a discounted sale would still migrate correctly, and step 4
-- proves it did.
INSERT INTO "SaleItem" (id, "saleId", "productId", "moduleKey", quantity, "unitPrice", "discountPercent", "lineTotal", "netLineTotal")
SELECT i.id, i."saleId", i."productId", 'beverages', i.quantity, i."unitPrice", i."discountPercent", i."lineTotal",
       ROUND(i."lineTotal" * (1 - s."discountPercent" / 100), 2)
FROM "BeverageSaleItem" i
JOIN "BeverageSale" s ON s.id = i."saleId";

INSERT INTO "SaleItem" (id, "saleId", "productId", "moduleKey", quantity, "unitPrice", "discountPercent", "lineTotal", "netLineTotal")
SELECT i.id, i."saleId", i."productId", 'bakery', i.quantity, i."unitPrice", i."discountPercent", i."lineTotal",
       ROUND(i."lineTotal" * (1 - s."discountPercent" / 100), 2)
FROM "BakerySaleItem" i
JOIN "BakerySale" s ON s.id = i."saleId";

-- ---------------------------------------------------------------------------
-- 4. Assert, or roll the whole migration back
-- ---------------------------------------------------------------------------
-- A migration that silently half-copies is worse than one that fails: the app
-- would come up looking fine on a subset of history. Every check below aborts
-- the transaction, leaving the old tables untouched and the new ones absent.
DO $$
DECLARE
  old_sales int; new_sales int;
  old_items int; new_items int;
  bad_module int;
  bad_net int;
BEGIN
  SELECT (SELECT COUNT(*) FROM "BeverageSale") + (SELECT COUNT(*) FROM "BakerySale") INTO old_sales;
  SELECT (SELECT COUNT(*) FROM "BeverageSaleItem") + (SELECT COUNT(*) FROM "BakerySaleItem") INTO old_items;
  SELECT COUNT(*) FROM "Sale"     INTO new_sales;
  SELECT COUNT(*) FROM "SaleItem" INTO new_items;

  IF new_sales <> old_sales THEN
    RAISE EXCEPTION 'ABORT: copied % of % sales', new_sales, old_sales;
  END IF;
  IF new_items <> old_items THEN
    RAISE EXCEPTION 'ABORT: copied % of % sale items', new_items, old_items;
  END IF;

  -- moduleKey must be one of the two known values on every row.
  SELECT COUNT(*) INTO bad_module FROM "SaleItem" WHERE "moduleKey" NOT IN ('beverages', 'bakery');
  IF bad_module <> 0 THEN
    RAISE EXCEPTION 'ABORT: % sale items have an unknown moduleKey', bad_module;
  END IF;

  -- THE RECONCILIATION THAT MATTERS: the per-line net amounts must sum to the
  -- bill total on every sale. If a bill discount ever left a rounding residue,
  -- this is what catches it rather than letting reports quietly disagree with
  -- the totals they are derived from.
  SELECT COUNT(*) INTO bad_net FROM (
    SELECT s.id
    FROM "Sale" s
    JOIN "SaleItem" i ON i."saleId" = s.id
    GROUP BY s.id, s."totalAmount"
    HAVING SUM(i."netLineTotal") <> s."totalAmount"
  ) AS mismatched;
  IF bad_net <> 0 THEN
    RAISE EXCEPTION 'ABORT: % sales where SUM(netLineTotal) <> totalAmount', bad_net;
  END IF;

  RAISE NOTICE 'OK: % sales and % items copied, module keys valid, net totals reconcile',
    new_sales, new_items;
END $$;
