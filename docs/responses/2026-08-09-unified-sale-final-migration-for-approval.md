# Unified sale — final schema and Migrations A + B, for approval

**Date:** 2026-08-09
**Status:** ⏸️ **HARD STOP — WAITING FOR YOUR EXPLICIT GO.**

Nothing run, nothing committed. **`prisma/schema.prisma` is unmodified on disk**, and
**neither migration folder exists in `prisma/migrations/`** — for a specific reason, see §4.
Everything below lives in a scratch directory and was produced with read-only tooling.

---

## 1. One thing I need to flag before anything else

> **Migration B must NOT sit in `prisma/migrations/` when you give the go for A.**

`prisma migrate deploy` applies **every pending migration in one run**. If both folders are
present when the go comes, A and B execute back to back — the old tables get dropped in the same
breath as the copy, and the two-part design is silently reduced to the one-part design it was
meant to replace.

The rollback window *is* the gap between A and B, and that gap only exists if B is withheld from
the migrations directory until the browser verification is done. So my plan is:

| When | Action |
|---|---|
| On your go | Write **only** Migration A into `prisma/migrations/`, run `migrate deploy` |
| After post-migration verify + API + form + edit UI + reports all verified | Write Migration B, run `migrate deploy` again |

I'd rather surface this than have you discover the old tables vanished on day one.

---

## 2. Final schema

Validated with `prisma validate` — valid, including the required back-relations
(`Customer.sales`, `Product.saleItems`).

```prisma
// ---------------------------------------------------------------------------
// Sales — ONE table for beverages AND bakery
// ---------------------------------------------------------------------------
// A bill can hold beverage and bakery lines together; the client orders across
// categories routinely. Milk is NOT here — it has no products, no stock, and
// its own MilkSale table, and nothing in this merge touches it.
//
// Replaces BeverageSale/BakerySale, which encoded the module in the TABLE. That
// made per-module revenue a sale-level SUM, which cannot survive a mixed bill.
// The module now lives on the LINE (see SaleItem.moduleKey).

model Sale {
  id              String     @id @default(cuid())
  customerId      String
  customer        Customer   @relation(fields: [customerId], references: [id])
  saleDate        DateTime   @default(now())
  discountPercent Decimal    @default(0) @db.Decimal(5, 2)
  totalAmount     Decimal    @db.Decimal(10, 2)
  notes           String?
  items           SaleItem[]
  createdAt       DateTime   @default(now())

  @@index([customerId, saleDate])
  @@index([saleDate])
}

model SaleItem {
  id              String  @id @default(cuid())
  saleId          String
  sale            Sale    @relation(fields: [saleId], references: [id], onDelete: Cascade)
  productId       String
  product         Product @relation(fields: [productId], references: [id])
  /// "beverages" | "bakery" — a SNAPSHOT of what this line was sold as.
  ///
  /// NOT derived from the product's category at report time. The catalog lets
  /// the owner move a product between sub-categories, and deriving would then
  /// silently re-attribute closed months between modules. A line's module is
  /// the same kind of fact as its unitPrice and its discount: what it was sold
  /// as, fixed at the moment of sale.
  moduleKey       String
  quantity        Int
  unitPrice       Decimal @db.Decimal(10, 2)
  discountPercent Decimal @default(0) @db.Decimal(5, 2)
  lineTotal       Decimal @db.Decimal(10, 2)
  /// This line's share of the bill AFTER the whole-bill discount.
  ///
  /// PER-MODULE REVENUE IS SUM(netLineTotal), NEVER SUM(lineTotal). Line totals
  /// add up to the SUBTOTAL, so summing them per module would overstate revenue
  /// on every bill-discounted sale and break the dashboard's claim that
  /// beverages + bakery + milk equals total revenue. Apportioned pro-rata by
  /// lineTotal, 2dp, residue to the largest line so the parts sum to
  /// totalAmount exactly. Allocation lives beside the discount maths in
  /// lib/sales.ts — one implementation.
  netLineTotal    Decimal @db.Decimal(10, 2)

  @@index([saleId])
  @@index([productId])
  @@index([moduleKey])
}
```

Also changing, on the two existing models:

```diff
 model Customer {
-  beverageSales BeverageSale[]
-  bakerySales   BakerySale[]
+  sales         Sale[]

 model Product {
-  beverageSaleItems BeverageSaleItem[]
-  bakerySaleItems   BakerySaleItem[]
+  saleItems SaleItem[]
```

New index worth noting: **`@@index([saleDate])`**. The old tables only had
`[customerId, saleDate]`, which does not help a report scanning a date window across all
customers — which is what every reports query does. Cheap to add now, awkward later.

---

## 3. Migration A — create, secure, copy, assert. Non-destructive.

Hand-ordered, **not** the generator's output. Full file:

```sql
-- 1. New tables ------------------------------------------------------------
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
    "moduleKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    "netLineTotal" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Sale_customerId_saleDate_idx" ON "Sale"("customerId", "saleDate");
CREATE INDEX "Sale_saleDate_idx"            ON "Sale"("saleDate");
CREATE INDEX "SaleItem_saleId_idx"          ON "SaleItem"("saleId");
CREATE INDEX "SaleItem_productId_idx"       ON "SaleItem"("productId");
CREATE INDEX "SaleItem_moduleKey_idx"       ON "SaleItem"("moduleKey");

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. RLS — required on every new table (CLAUDE.md) --------------------------
ALTER TABLE "Sale"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem" ENABLE ROW LEVEL SECURITY;

-- 3. Copy, PRESERVING IDS ---------------------------------------------------
INSERT INTO "Sale" (id, "customerId", "saleDate", "discountPercent", "totalAmount", notes, "createdAt")
SELECT id, "customerId", "saleDate", "discountPercent", "totalAmount", notes, "createdAt" FROM "BeverageSale";

INSERT INTO "Sale" (id, "customerId", "saleDate", "discountPercent", "totalAmount", notes, "createdAt")
SELECT id, "customerId", "saleDate", "discountPercent", "totalAmount", notes, "createdAt" FROM "BakerySale";

INSERT INTO "SaleItem" (id, "saleId", "productId", "moduleKey", quantity, "unitPrice", "discountPercent", "lineTotal", "netLineTotal")
SELECT i.id, i."saleId", i."productId", 'beverages', i.quantity, i."unitPrice", i."discountPercent", i."lineTotal",
       ROUND(i."lineTotal" * (1 - s."discountPercent" / 100), 2)
FROM "BeverageSaleItem" i JOIN "BeverageSale" s ON s.id = i."saleId";

INSERT INTO "SaleItem" (id, "saleId", "productId", "moduleKey", quantity, "unitPrice", "discountPercent", "lineTotal", "netLineTotal")
SELECT i.id, i."saleId", i."productId", 'bakery', i.quantity, i."unitPrice", i."discountPercent", i."lineTotal",
       ROUND(i."lineTotal" * (1 - s."discountPercent" / 100), 2)
FROM "BakerySaleItem" i JOIN "BakerySale" s ON s.id = i."saleId";

-- 4. Assert, or roll the whole migration back -------------------------------
DO $$
DECLARE old_sales int; new_sales int; old_items int; new_items int; bad_module int; bad_net int;
BEGIN
  SELECT (SELECT COUNT(*) FROM "BeverageSale") + (SELECT COUNT(*) FROM "BakerySale") INTO old_sales;
  SELECT (SELECT COUNT(*) FROM "BeverageSaleItem") + (SELECT COUNT(*) FROM "BakerySaleItem") INTO old_items;
  SELECT COUNT(*) FROM "Sale"     INTO new_sales;
  SELECT COUNT(*) FROM "SaleItem" INTO new_items;

  IF new_sales <> old_sales THEN RAISE EXCEPTION 'ABORT: copied % of % sales', new_sales, old_sales; END IF;
  IF new_items <> old_items THEN RAISE EXCEPTION 'ABORT: copied % of % sale items', new_items, old_items; END IF;

  SELECT COUNT(*) INTO bad_module FROM "SaleItem" WHERE "moduleKey" NOT IN ('beverages','bakery');
  IF bad_module <> 0 THEN RAISE EXCEPTION 'ABORT: % items have an unknown moduleKey', bad_module; END IF;

  SELECT COUNT(*) INTO bad_net FROM (
    SELECT s.id FROM "Sale" s JOIN "SaleItem" i ON i."saleId" = s.id
    GROUP BY s.id, s."totalAmount"
    HAVING SUM(i."netLineTotal") <> s."totalAmount"
  ) AS mismatched;
  IF bad_net <> 0 THEN RAISE EXCEPTION 'ABORT: % sales where SUM(netLineTotal) <> totalAmount', bad_net; END IF;

  RAISE NOTICE 'OK: % sales and % items copied, module keys valid, net totals reconcile', new_sales, new_items;
END $$;
```

Four independent aborts, any of which rolls the whole thing back leaving the old tables untouched
and the new ones absent. The fourth is the one worth pointing at: **it proves
`Σ netLineTotal = totalAmount` on every sale**, so the reconciliation you asked me to verify with
numbers is enforced by the migration itself, not just checked afterwards.

`netLineTotal` is **computed** from the bill discount rather than assumed equal to `lineTotal`.
Every existing sale has a 0.00 bill discount so they coincide today — but a discounted sale would
migrate correctly, and the assert would catch it if it didn't.

---

## 4. Migration B — drop the old tables. Withheld until after verification.

```sql
-- Re-assert before destroying anything: every OLD sale id must still exist in
-- "Sale". A bare count would pass if a sale had been deleted and another
-- created in the gap — a gap that deliberately contains a human clicking around.
DO $$
DECLARE old_sales int; new_sales int; missing int;
BEGIN
  SELECT (SELECT COUNT(*) FROM "BeverageSale") + (SELECT COUNT(*) FROM "BakerySale") INTO old_sales;
  SELECT COUNT(*) FROM "Sale" INTO new_sales;

  SELECT COUNT(*) INTO missing FROM (
    SELECT id FROM "BeverageSale" UNION ALL SELECT id FROM "BakerySale"
  ) AS old_ids
  WHERE NOT EXISTS (SELECT 1 FROM "Sale" s WHERE s.id = old_ids.id);

  IF missing <> 0 THEN
    RAISE EXCEPTION 'ABORT: % migrated sale(s) missing from "Sale" — not dropping anything', missing;
  END IF;

  RAISE NOTICE 'OK: all % legacy sales accounted for (now % rows); dropping legacy tables', old_sales, new_sales;
END $$;

DROP TABLE "BeverageSaleItem";
DROP TABLE "BakerySaleItem";
DROP TABLE "BeverageSale";
DROP TABLE "BakerySale";
```

The re-assert checks **ids**, not counts, deliberately.

---

## 5. What Saif's sale becomes

The whole migration is one sale and one line.

| | Before (`BakerySale`) | After (`Sale`) |
|---|---|---|
| id | `cmsjh3kly0002uve8ajkvs2ji` | **unchanged** |
| customer | Saif | unchanged |
| saleDate | 2026-08-07 19:00:00 | unchanged |
| bill discount | 0.00 | unchanged |
| **total** | **5000.00** | **5000.00** |

| Line | Before (`BakerySaleItem`) | After (`SaleItem`) |
|---|---|---|
| id | `cmsjh3kly0004uve8zootrgoy` | **unchanged** |
| product / qty / unitPrice | prod_buns / 100 / 50.00 | unchanged |
| lineTotal | 5000.00 | unchanged |
| **moduleKey** | — (implied by the table) | **`bakery`** |
| **netLineTotal** | — | **5000.00** |

---

## 6. On your go, in order

1. Apply the schema change and write **Migration A only** into `prisma/migrations/`; run
   `prisma migrate deploy` (never `migrate dev` — `deploy` cannot reset).
2. **Verify against the live DB and show you before building:** Saif's sale present with
   `moduleKey='bakery'` and `netLineTotal=5000.00`, counts matching the assert, RLS `true` /
   `force_rls` `false` on `Sale` and `SaleItem`, milk untouched.
3. Then: unified API (reusing `reconcileSaleLines`, the discount maths and the stock
   reconciliation unchanged) → `/sales` form + edit UI on the PATCH → reports rewritten to
   line-level `Σ netLineTotal` grouped by `moduleKey`.
4. Browser-verify with numbers, including `Σ netLineTotal == totalAmount` on a bill-discounted
   mixed sale.
5. **Migration B last**, only once all of that passes.

---

### Source used

**Context7: attempted, still not connecting — 10th consecutive session.** Installed-source
fallback per the CLAUDE.md rule:

- The `CREATE TABLE` / index / FK statements above are **the installed Prisma 6 CLI's own output**
  (`migrate diff --script` against the live datasource), lifted verbatim into the hand-ordered
  file — so the DDL matches exactly what Prisma expects the schema to be, while the ordering and
  the data-migration steps are mine.
- The final schema was checked with `prisma validate`.
- Row counts, ids and column values for Saif's sale were read from the **live database**.
