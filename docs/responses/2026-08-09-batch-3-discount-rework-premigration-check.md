# Discount rework — pre-migration safety check, delete list and migration SQL

**Date:** 2026-08-09
**Status:** ⏸️ **HARD STOP — WAITING FOR YOUR GO.**

Nothing has been run. No migration, no delete, no schema file edited, no commit. `prisma/schema.prisma`
is untouched on disk — the SQL below was generated against a **scratch copy** in a temp directory
using `prisma migrate diff`, which reads schema files and writes nothing.

This is step 1 of your build order only: *confirm no real sale references a variant + show the
migration SQL and the delete list, then wait.*

---

## ⚠️ Read this first — the counts in the brief are wrong, in a dangerous direction

> The brief says: *"Delete the ~48 discount-variant products. Keep only the ~15 base products."*

**The real numbers are 36 to delete and 27 to keep.**

Where the 48 comes from: Pepsi, Coke Cola and Gourmet contain **48 rows in total** (3 brands ×
4 sizes × 4 price tiers). But **12 of those 48 are the base products themselves** — `Pepsi 1.5L`,
`Coke Cola 1L`, `Gourmet 0.5L` and so on. Only the 20/30/60% rows are variants:
3 brands × 4 sizes × **3** discount tiers = **36**.

**Deleting "the 48" literally would destroy the entire beverage catalog** — every Pepsi, Coke and
Gourmet product, including the base rows the rework is meant to keep. I've built the delete list
from the 36, and every figure below is verified against the live database rather than restated
from the brief.

| | Brief | Actual |
|---|---|---|
| Variants to delete | ~48 | **36** |
| Products remaining | ~15 | **27** (26 seeded + 1 owner-created) |
| Products today | 62 | **63** |

---

## 1. Safety check — does any sale reference a variant?

**PASS. Zero.** Run against the live database just now:

| Check | Result |
|---|---|
| `BeverageSaleItem` rows pointing at a variant | **0** |
| `BakerySaleItem` rows pointing at a variant | **0** |
| Total `BeverageSaleItem` rows in the DB | 0 |
| Total `BakerySaleItem` rows in the DB | **1** |
| Total `BeverageSale` / `BakerySale` rows | 0 / **1** |

The only sale line that exists anywhere is Saif's single bakery sale, and it points at
`prod_buns` — a **base** product, which the delete does not touch. There is no history to lose
and nothing to abort for.

---

## 2. Which predicate to delete by

You asked for specific seeded ids rather than a blanket `discountPercent > 0`. I ran both and
compared them, because "they should agree" is worth proving rather than assuming:

| | Rows matched |
|---|---|
| Seeded id pattern (`prod_%_d20` / `_d30` / `_d60`) | **36** |
| Blanket `discountPercent > 0` | **36** |
| Flagged by `discountPercent` but NOT matching the seeded id pattern | **0** |
| Matching the seeded id pattern but NOT flagged | **0** |

They are the same set today. **I'll still use the explicit id list**, for the reason you gave:
the id pattern can only ever match seed-generated rows, whereas `discountPercent > 0` would
silently capture any product the owner creates through the catalog UI with a discount set. That
is a live hazard — `ProductDialog` currently exposes a discount field, so the owner can create
such a row at any time.

**Big Apple 0.5L** (`cmsjhlfi1000duve826ian5m4`, owner-created, Rs. 120) is excluded by both
predicates — its `discountPercent` is 0 and its id is a cuid, not a `prod_` id. It survives.

---

## 3. The exact delete list — 36 ids

```
prod_coke_cola_1_5l_d20          prod_gourmet_1_5l_d20          prod_pepsi_1_5l_d20
prod_coke_cola_1_5l_d30          prod_gourmet_1_5l_d30          prod_pepsi_1_5l_d30
prod_coke_cola_1_5l_d60          prod_gourmet_1_5l_d60          prod_pepsi_1_5l_d60
prod_coke_cola_1l_d20            prod_gourmet_1l_d20            prod_pepsi_1l_d20
prod_coke_cola_1l_d30            prod_gourmet_1l_d30            prod_pepsi_1l_d30
prod_coke_cola_1l_d60            prod_gourmet_1l_d60            prod_pepsi_1l_d60
prod_coke_cola_2_25l_d20         prod_gourmet_2_25l_d20         prod_pepsi_2_25l_d20
prod_coke_cola_2_25l_d30         prod_gourmet_2_25l_d30         prod_pepsi_2_25l_d30
prod_coke_cola_2_25l_d60         prod_gourmet_2_25l_d60         prod_pepsi_2_25l_d60
prod_coke_cola_half_litre_d20    prod_gourmet_half_litre_d20    prod_pepsi_half_litre_d20
prod_coke_cola_half_litre_d30    prod_gourmet_half_litre_d30    prod_pepsi_half_litre_d30
prod_coke_cola_half_litre_d60    prod_gourmet_half_litre_d60    prod_pepsi_half_litre_d60
```

12 per brand × 3 brands. No bakery row appears — bakery has no discount variants at all.

### The 27 that survive

| Sub-category | Kept |
|---|---|
| Pepsi | Pepsi 0.5L, 1L, 1.5L, 2.25L |
| Coke Cola | Coke Cola 0.5L, 1L, 1.5L, 2.25L |
| Gourmet | Gourmet 0.5L, 1L, 1.5L, 2.25L |
| Juice | Juice 0.5L, Juice 1L |
| Big Apple | Big Apple, **Big Apple 0.5L** ← owner-created, preserved |
| Big Lychee | Big Lychee |
| Cake Rusk | Premium, Simple |
| Biscuits | Premium, Simple |
| Buns | Buns ← Saif's sale points here |
| Russ | Large Circle, Large Rectangular Round, Small Circle, Small Rectangular Round |
| Eggs | Eggs |

---

## 4. The delete SQL (not run)

```sql
-- Pre-flight guard: must return 0, or abort.
SELECT COUNT(*) FROM "BeverageSaleItem" WHERE "productId" IN (<the 36 ids>);
SELECT COUNT(*) FROM "BakerySaleItem"   WHERE "productId" IN (<the 36 ids>);

-- The delete itself.
DELETE FROM "Product"
WHERE id IN (
  'prod_pepsi_half_litre_d20','prod_pepsi_half_litre_d30','prod_pepsi_half_litre_d60',
  'prod_pepsi_1l_d20','prod_pepsi_1l_d30','prod_pepsi_1l_d60',
  'prod_pepsi_1_5l_d20','prod_pepsi_1_5l_d30','prod_pepsi_1_5l_d60',
  'prod_pepsi_2_25l_d20','prod_pepsi_2_25l_d30','prod_pepsi_2_25l_d60',
  'prod_coke_cola_half_litre_d20','prod_coke_cola_half_litre_d30','prod_coke_cola_half_litre_d60',
  'prod_coke_cola_1l_d20','prod_coke_cola_1l_d30','prod_coke_cola_1l_d60',
  'prod_coke_cola_1_5l_d20','prod_coke_cola_1_5l_d30','prod_coke_cola_1_5l_d60',
  'prod_coke_cola_2_25l_d20','prod_coke_cola_2_25l_d30','prod_coke_cola_2_25l_d60',
  'prod_gourmet_half_litre_d20','prod_gourmet_half_litre_d30','prod_gourmet_half_litre_d60',
  'prod_gourmet_1l_d20','prod_gourmet_1l_d30','prod_gourmet_1l_d60',
  'prod_gourmet_1_5l_d20','prod_gourmet_1_5l_d30','prod_gourmet_1_5l_d60',
  'prod_gourmet_2_25l_d20','prod_gourmet_2_25l_d30','prod_gourmet_2_25l_d60'
);
-- Expect: DELETE 36, leaving 27 rows in "Product".
```

There is no `ON DELETE CASCADE` from `Product` to the sale-item tables — the relation is a plain
FK — so if a sale line *did* reference one of these, Postgres would raise a foreign-key violation
rather than quietly deleting history. That's a second line of defence behind the check in §1.

---

## 5. Schema change

Four additive fields. `prisma/schema.prisma` is **not yet edited** — this is the proposed diff:

```diff
 model BeverageSale {
   ...
+  discountPercent Decimal          @default(0) @db.Decimal(5, 2)
   totalAmount Decimal            @db.Decimal(10, 2)

 model BeverageSaleItem {
   ...
+  discountPercent Decimal @default(0) @db.Decimal(5, 2)
   lineTotal Decimal      @db.Decimal(10, 2)

 model BakerySale {
   ...
+  discountPercent Decimal        @default(0) @db.Decimal(5, 2)
   totalAmount Decimal          @db.Decimal(10, 2)

 model BakerySaleItem {
   ...
+  discountPercent Decimal @default(0) @db.Decimal(5, 2)
   lineTotal Decimal    @db.Decimal(10, 2)
```

### Generated migration SQL

Produced by `prisma migrate diff --script` (read-only, nothing applied):

```sql
-- AlterTable
ALTER TABLE "BeverageSale" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BeverageSaleItem" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BakerySale" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BakerySaleItem" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
```

Four `ADD COLUMN`s with defaults — additive, safe on existing rows, and Saif's bakery sale simply
gets `0` in both new columns, which is exactly what it was charged.

**I verified there is no schema drift first:** the four live tables' columns match
`schema.prisma` exactly and none already has a `discountPercent`, so this diff is the true delta.

### Two decisions in that schema worth your eye

1. **`Decimal(5,2)`, not `Int`.** Lets the owner enter `7.5%`. Money math stays on `Prisma.Decimal`
   end to end (Gotcha 2) — a percentage held as a float is how rounding drifts.
2. **`NOT NULL DEFAULT 0`, not nullable.** The brief said "nullable/default 0"; I'd take the
   non-null option. `null` and `0` mean the same thing for a discount, and this project has
   already been bitten once by that exact ambiguity — `docs/phase-4-bakery-module.md` records a
   bug where `discountPercent = 0` vs `null` broke a falsy check. Non-null makes the arithmetic
   total: every line is `× (1 − d/100)` with no branch. Say the word if you'd rather have
   nullable.

---

## 6. `Product.discountPercent` — my recommendation is to keep it for now

You asked me to check whether it's used anywhere beyond variants. It appears in 6 places, and
**all of them exist to serve the variant concept**:

| File | Use |
|---|---|
| `components/catalog/ProductDialog.tsx` | lets the owner set a discount when creating a product |
| `components/catalog/ProductTable.tsx` | the catalog's discount column |
| `lib/sale-catalog.ts` | picker label (`30% off`) and variant sort order |
| `components/sales/SaleLineItems.tsx` | shows `30% off` on a historical sale line |
| `lib/catalog-display.ts` | `formatDiscount()` |
| `lib/validations/catalog.ts` | the create/update schema |

So by your rule it qualifies for removal. **But I'd do that as a second, separate migration after
the rework is browser-verified**, not in this one:

- Dropping a column is irreversible, and this migration already carries a 36-row delete against a
  live database. Two destructive things in one hard-stop migration is one too many.
- The moment the column is dropped, six files stop compiling. Those files are being rewritten
  anyway during the UI step — doing the drop afterwards means the app is never in a state where
  the schema and the code disagree.
- Leaving it is harmless in the meantime: after the delete, all 27 surviving products have
  `discountPercent` 0 or null.

One thing I *would* do during the build step, before any drop: **remove the discount field from
`ProductDialog`**, so the owner cannot create a new variant product and quietly reintroduce what
this migration just deleted. That's a UI change, no schema involved.

---

## 7. Seed

`prisma/seed.ts` currently builds `BEVERAGE_SIZES.flatMap(size => DISCOUNT_TIERS.map(...))` with
`DISCOUNT_TIERS = [0, 20, 30, 60]`. The change is to drop the tier loop and keep one row per size.

| | Now | After |
|---|---|---|
| Seeded products | 62 | **26** |
| Rows in the DB | 63 | **27** (26 seeded + Big Apple 0.5L) |

Breakdown of the 26: 12 beverage base (3 brands × 4 sizes) + 2 Juice + Big Apple + Big Lychee
+ 10 bakery.

Note the seed is `upsert` with `update: {}` on deterministic ids, so re-running it after the
delete will **not** resurrect the variants once the tier loop is gone — but it *would* resurrect
all 36 if the seed is re-run before `seed.ts` is updated. The seed change and the delete need to
land together.

---

## 8. The discount math I'll implement (stating it back for confirmation)

Exactly as specified, no invention:

```
lineTotal = round(qty × unitPrice × (1 − lineDiscountPercent / 100), 2)
subtotal  = Σ lineTotal
total     = round(subtotal × (1 − saleDiscountPercent / 100), 2)
```

Rounded to 2 decimals at **both** points, on `Prisma.Decimal`, never on a JS float. Base
`unitPrice` follows the existing rule unchanged — typed value if given, else the catalog price,
snapshotted per Gotcha 5. This goes through `reconcileSaleLines` in `lib/sales.ts`, extended to
carry discount; no parallel path.

Worked example using your float-drift case, 3 × Rs. 333.00 with 7% line and 5% bill:

| Step | Value |
|---|---|
| `3 × 333.00` | 999.00 |
| `× (1 − 0.07)` | 929.07 |
| subtotal | 929.07 |
| `× (1 − 0.05)` | 882.6165 → **882.62** |

And the single-line version that exposes the drift: `333 × 0.93` evaluates to
`309.69000000000005` in IEEE floats; on Decimal it is `309.69`. That's the case I'll use in the
browser verification.

---

## 9. What I need from you

**Reply "go" and I will, in order:** apply the schema change, run the migration, run the guarded
delete of the 36 ids, and update `seed.ts` — then build the API math, then the UI, and browser-verify
before any commit.

Flag anything you want changed first — in particular:
- the **36 vs 48** correction (§0), since it contradicts the brief;
- non-null vs nullable `discountPercent` (§5);
- deferring the `Product.discountPercent` drop to a second migration (§6).

---

### Context7

Attempted again. Still not connecting — this is the **5th consecutive session**. Fell back to
source per the updated CLAUDE.md rule: the migration SQL here is generated by the installed
Prisma 6 CLI itself rather than written from memory, and the schema conventions were checked
against `prisma/schema.prisma` and the existing migration in `prisma/migrations/`.
