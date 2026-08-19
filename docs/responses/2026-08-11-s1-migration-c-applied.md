# S1 — Migration C APPLIED and reconciled

**Date:** 2026-08-11
**Commit:** `fa18e16` — pushed to `main`
**Result:** applied, reconciled against the real row, app verified. Database schema up to date.

---

## STEP 0 — Backup safety: **no backup file is in the repo**

Searched the whole repository. **There is no `.sql` dump, `.dump`, `.bak` or `.backup` file
anywhere** — the only `.sql` files are the 8 Prisma migrations (all legitimately tracked), and the
`.gz` files are Next's webpack cache under `.next/` (already ignored).

```
$ git ls-files "*.sql" | grep -v "^prisma/migrations/"
(nothing)
```

**So the backup is not in the project root, and nothing needed un-tracking.** That is the *safe*
outcome — presumably you saved it elsewhere on disk. **I neither committed nor deleted anything**,
and I did not go looking outside the repo for your file.

> **If you believe you saved it into the project root, please check** — it isn't there, and the
> difference between "saved somewhere else" and "not saved" matters, since the whole gate rests on
> it. I proceeded on your explicit confirmation that the backup exists.

### Guards added anyway, so a future dump cannot land in git

```gitignore
# database backups — NEVER commit a dump. Root-anchored so prisma/migrations/*.sql
# (which ARE the schema history and must stay tracked) are unaffected.
/*.sql
/*.dump
/*.backup
/backups/

# Supabase CLI scratch. Holds the project ref and the pooler URL — local state,
# not source.
supabase/.temp/
```

**Both directions verified with `git check-ignore`:**

| | |
|---|---|
| `prisma/migrations/…/migration.sql` | **NOT ignored** ✓ — schema history stays tracked |
| a root `zz-probe.sql` | **IGNORED** ✓ |
| `supabase/.temp/project-ref` | **IGNORED** ✓ |

I also found an untracked `supabase/` directory — CLI scratch (`linked-project.json`,
`project-ref`, `pooler-url`), **not** your backup. It was never tracked; it is now ignored so it
can't be committed by accident.

---

## STEP 1 — Pre-apply state

**HEAD `95122e1`**, migration staged and unapplied:

```
$ npx prisma migrate status
8 migrations found in prisma/migrations
Following migration have not yet been applied:
20260811120000_widen_saleitem_quantity
```

**Recorded before touching anything:**

| | PRE-APPLY |
|---|---|
| `SaleItem.quantity` type | **`integer`** |
| `SaleItem.productId` nullable | `NO` |
| The real row | `cmsjh3kly0004uve8zootrgoy` · `prod_buns` · `bakery` · qty **`100`** · unit `50.00` · line `5000.00` · net `5000.00` |
| `_prisma_migrations` | **7** |
| `Product` | 27, fingerprint `95794a0bb44f1b15d541a60ef0bd5c51` |
| `Customer` / `BakerySale` / `MilkSale` / `Sale` | Saif / `5000.00` / `6000.00` / `5000.00` |

---

## STEP 2 — Applied

```
$ npx prisma migrate deploy
8 migrations found in prisma/migrations
Applying migration `20260811120000_widen_saleitem_quantity`
The following migration(s) have been applied:
  └─ 20260811120000_widen_saleitem_quantity/migration.sql
All migrations have been successfully applied.
```

`migrate deploy` — **not** `migrate reset`, **not** `db push`.

---

## STEP 3 — Reconciled for real

### The row, before and after — observed, not predicted

| | BEFORE | AFTER |
|---|---|---|
| `quantity` type | `integer` | **`numeric(10,2)`** |
| `quantity` text | `100` | **`100.00`** |
| `quantity = 100` | — | **`true`** ✅ |
| `quantity × unitPrice = lineTotal` | — | **`true`** ✅ |
| `unitPrice` | `50.00` | `50.00` |
| `lineTotal` / `netLineTotal` | `5000.00` / `5000.00` | `5000.00` / `5000.00` |
| `id` / `productId` / `moduleKey` | `…rgoy` / `prod_buns` / `bakery` | unchanged |

**The representation changed; the value did not.** `100 → 100.00` was the one predicted difference,
and the arithmetic still reconciles exactly.

### Structure

| Check | Result |
|---|---|
| `productId` nullable | **`NO`** — we did not widen it, as designed |
| Constraints on `SaleItem` | **unchanged**: `SaleItem_pkey`, `SaleItem_saleId_fkey`, `SaleItem_productId_fkey`. **No CHECK added** |
| `_prisma_migrations` | **7 → 8** ✅ |
| `migrate status` | **"Database schema is up to date!"** |

### `moduleKey` still accepts its values — proved without writing

A probe inside `BEGIN … ROLLBACK`:

```sql
INSERT INTO "SaleItem" (… "moduleKey", quantity …) VALUES (… 'milk', 2.5 …);
→ moduleKey: "milk"   quantity: "2.50"
ROLLBACK;
```

**Both halves of the migration's purpose demonstrated at once** — `'milk'` is accepted, and `2.5`
stores as `2.50`. Then rolled back: `SaleItem` is still **1 row**, probe rows **0**, the real row
still `100.00`.

### Real data intact

| | |
|---|---|
| `Product` | **27**, fingerprint `95794a0bb44f1b15d541a60ef0bd5c51` — **identical to pre-apply** |
| `Customer` | **1** — `Saif` |
| `BakerySale` | 1 @ **Rs. 5,000** · `MilkSale` 1 @ **Rs. 6,000** · `BeverageSale` 0 |
| `Sale` (unified) | Rs. 5,000 |
| `User` | 1 — `i228767@nu.edu.pk` |

---

## STEP 4 — App verification

| Check | Result |
|---|---|
| `tsc --noEmit` (4096 heap) | **exit 0** |
| `next lint` | **clean** |
| `npm run build` | **green** |
| Newly failing typecheck | **none** — no application code reads `SaleItem` yet |
| `/beverages/new-sale` | **200** |
| `/bakery/new-sale` | **200** |
| `/milk/sales` (milk sale dialog) | **200** |

### End-to-end sales through the OLD paths, post-migration

**Beverages** — `ZZ_TEST_`, 3 × Rs. 275.50, 10% line, 5% bill:

```
qty 3 · unitPrice 275.5 · lineTotal 743.85 · total 706.66
```

Identical to the same probe run before the migration.

**Milk** — `ZZ_TEST_`, 2.5 L × Rs. 120:

```
liters 2.5 · ratePerLiter 120 · totalAmount 300
```

Both recorded correctly. All `ZZ_TEST_` rows then removed (user, customer, beverage sale + item,
two milk sales); product stock restored to 100; fingerprint re-verified.

---

## The commit

```
fa18e16  feat(db): Migration C — widen SaleItem.quantity to Decimal(10,2) for litres
         3 files changed, 25 insertions(+), 4 deletions(-)
          .gitignore
          prisma/schema.prisma
          prisma/migrations/20260811120000_widen_saleitem_quantity/migration.sql
```

**Verified before committing that no `.sql` outside `prisma/migrations/` was staged.** The backup
file was not committed and not deleted.

---

## Constraint compliance

| Constraint | Status |
|---|---|
| Backup file neither committed nor deleted | ✅ it is not in the repo; guards added so one can't be |
| Farmer code untouched (`Farmer`, `MilkDelivery`, `FarmerPurchase`, farmer libs/UI/API) | ✅ never opened or queried |
| 2 real sales + Saif unmodified beyond the lossless ALTER | ✅ reconciled after; fingerprint identical |
| Additive/widening only — no other schema change, no data migration, no sale-path removal, no reporting repoint | ✅ one `ALTER … SET DATA TYPE` |
| Milk-as-product data / multi-unit / chilling charges not touched | ✅ none attempted |
| No dependency installs/removals | ✅ |

---

## Where S1 leaves the project

**Done:** the schema can now hold a milk line — decimal litres and a `"milk"` module value — while
`productId` stays `NOT NULL` and the FK stays enforced.

**Unchanged:** every sale path, every screen, every report. The app records sales exactly as it did
this morning.

**Next, when you're ready — S2:** split `lib/milk.ts` so the two milk-**sale** exports
(`MILK_SALE_SELECT`, `computeMilkSaleTotal`) move out and the farmer file is left untouched. A file
move, not a logic change, with a farmer-side verification gate.

**Still open before S3/S4 can be designed properly** — the questions from the design doc, most
importantly how the owner enters a milk line and whether a mixed receipt needs per-category
subtotals. Plus the new one this stage surfaced: **a milk `Product` needs a third `Category`**
(only Bakery and Beverages exist), and `Product.stock` defaults to **100**, which is meaningless for
milk until the stock bridge lands.
