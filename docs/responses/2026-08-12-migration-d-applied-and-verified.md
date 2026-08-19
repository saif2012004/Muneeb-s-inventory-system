# Migration D — APPLIED, verified, committed ✅

**Date:** 2026-08-12
**Commit:** **`8847fff`** — `feat(db): Migration D — widen Product.stock to Decimal(10,2) for litres`
**Result:** applied cleanly on the first attempt. **Every reconciliation matched. No mismatch, no
data touched, nothing left behind.**

---

## 1. Apply

```
$ npx prisma migrate deploy

9 migrations found in prisma/migrations

Applying migration `20260812120000_widen_product_stock`

The following migration(s) have been applied:
  migrations/
    └─ 20260812120000_widen_product_stock/
      └─ migration.sql

All migrations have been successfully applied.        [exit 0]
```

✅ **No `P3006`, no error, no warning.** `migrate deploy` only — never `reset`, never `db push`, and
nothing was passed to `--shadow-database-url`.

---

## 2. Reconciliation — all 27 products

| Check | Before | After | |
|---|---|---|---|
| Column type | `integer` | **`numeric(10,2)`** | ✅ |
| Column default | `100` | `100` | ✅ |
| Products | 27 | **27** | ✅ |
| `sum(stock)` | `2700` | **`2700.00`** | ✅ same value |
| min / max | 100 / 100 | **100.00 / 100.00** | ✅ |
| Rows `<> 100` | — | **0** | ✅ |

### The fingerprint comparison — this is the part that actually proves it

A raw `stock::text` fingerprint *must* change (`100` → `100.00`), so on its own it proves nothing.
Before applying I therefore captured a **representation-stable** fingerprint that casts to
`numeric(10,2)` on **both** sides of the migration, so it compares VALUES rather than formatting:

| Fingerprint | Before | After | |
|---|---|---|---|
| **Value-stable stock** `md5(id='stock::numeric(10,2)')` | `91c0ca3185c4daadd4a9c7be1bfa0e77` | **`91c0ca3185c4daadd4a9c7be1bfa0e77`** | ✅ **IDENTICAL** |
| **Value-stable product** (id·name·price·stock·isActive) | `b57a51bb57be89cbc9db646d4a2a9972` | **`b57a51bb57be89cbc9db646d4a2a9972`** | ✅ **IDENTICAL** |
| Raw representation `md5(id='stock::text')` | `23cc9f6e0d2128de22ba7487473ea525` | `91c0ca3185c4daadd4a9c7be1bfa0e77` | ✅ **changed as expected** |

**All 27 values are byte-identical across the migration.** Ids, names, prices and active flags too.

There is a neat confirmation hiding in that table: **after the migration the raw fingerprint now
equals the value-stable one** (`91c0ca31…`). That is exactly what must happen once the column *is*
`numeric(10,2)` — the two expressions become the same expression. The representation change is
accounted for rather than waved through, the same way Migration C's `quantity` was.

---

## 3. Real records — untouched

| Record | Expected | Actual | |
|---|---|---|---|
| `BakerySale` | 5,000 | **5000.00** | ✅ |
| `MilkSale` | 6,000 | **6000.00** | ✅ |
| `Sale` (unified, dormant) | 5,000 | **5000.00** | ✅ |
| `SaleItem.quantity` | 100.00 | **100.00** | ✅ |
| `BeverageSale` | 0 | **0** | ✅ |
| Customer | Saif | **Saif** (1) | ✅ |
| User | owner | **`i228767@nu.edu.pk`** (1) | ✅ |

### Farmer data — read-only throughout, fully intact

| | Expected | Actual | |
|---|---|---|---|
| `Farmer` | Saif | **Saif** (1) | ✅ |
| `MilkDelivery` | 250 L @ 30,000 | **250.00 L @ 30000.00** | ✅ |
| `FarmerPurchase` | 25,000 | **25000.00** | ✅ |
| **Net owed** | **5,000** | **5000.00** | ✅ |

**No farmer table was written to at any point this turn.**

---

## 4. Migration status — 8 → 9

```
$ npx prisma migrate status

9 migrations found in prisma/migrations

Database schema is up to date!
```

✅ Ends on `20260812120000_widen_product_stock`.

---

## 5. RLS — all 18 tables still enabled, none FALSE

| Table | `relrowsecurity` | Forced | Policies |
|---|---|---|---|
| `BakerySale` | **true** | false | 0 |
| `BakerySaleItem` | **true** | false | 0 |
| `BeverageSale` | **true** | false | 0 |
| `BeverageSaleItem` | **true** | false | 0 |
| `Category` | **true** | false | 0 |
| `Customer` | **true** | false | 0 |
| `CustomerPayment` | **true** | false | 0 |
| `Farmer` | **true** | false | 0 |
| `FarmerPurchase` | **true** | false | 0 |
| `MilkDelivery` | **true** | false | 0 |
| `MilkSale` | **true** | false | 0 |
| `Product` | **true** | false | 0 |
| `Sale` | **true** | false | 0 |
| `SaleItem` | **true** | false | 0 |
| `Settings` | **true** | false | 0 |
| `SubCategory` | **true** | false | 0 |
| `User` | **true** | false | 0 |
| `_prisma_migrations` | **true** | false | 0 |

✅ **Nothing flagged.** 18/18 enabled, zero policies (default deny), `FORCE RLS` off everywhere so
Prisma's owner connection is unaffected. An `ALTER COLUMN` does not disturb RLS, and this confirms it
did not.

---

## 6. Typecheck and build — green post-apply

| Check | Result |
|---|---|
| `tsc --noEmit` (4096 heap) | ✅ **0 errors** (was 4 before the code fix) |
| `next lint` | ✅ no warnings or errors |
| `npm run build` | ✅ **Compiled successfully** |
| Edge bundle guardrail (production artifact) | ✅ 0 hits for `@prisma/client` / `PrismaClient` / `bcryptjs` / `.prisma` |

---

## 7. The `ZZ_TEST_` sale — stock decrements and restores on the Decimal column

Run through the **real HTTP route** in an authenticated session, not by direct SQL.

```
signed in as      : zz_test_stock@example.invalid
product           : cmsjhlfi1000duve826ian5m4
stock BEFORE      = 100        column is Decimal: true
POST /api/beverages/sales -> 201 created
sale total        = 750        (3 x 250)
stock AFTER SALE  = 97   | expected 97   | DECREMENTED CORRECTLY ✅
DELETE            -> 200
stock AFTER DELETE= 100  | baseline 100  | RESTORED ✅
cleanup: temp user gone = true | BeverageSale = 0 | User count = 1
```

✅ The decrement lands on the now-Decimal column, and the delete restores it.

### And the capability the migration actually exists for: a FRACTIONAL decrement

The whole point of Migration D is `12.5`, which the 3-unit test above does not exercise. The API
validator still blocks fractional quantities (see the open item below), so I proved it at the layer
the migration changed — using the exact conditional-`updateMany` shape `applyStockDeltas` uses,
**inside a transaction I deliberately rolled back** so nothing could persist:

```
stock before       = 100
matched rows       = 1          (the `stock >= 12.5` guard passed)
stock -12.5        = 87.5       FRACTIONAL DECREMENT WORKS ✅
stock after r/back = 100        ROLLED BACK, NOTHING PERSISTED ✅
```

**`100 → 87.5`.** That is the thing an `Int` column could not do, and the reason this migration
exists. Zero risk taken to prove it: the transaction always throws.

### Test hygiene

A temporary `ZZ_TEST_` user was needed for an authenticated session (the established practice in
this repo). It was removed, and cleanup was moved into a `finally` block after a first attempt
failed — so a thrown error could not strand it.

**Final state confirms nothing leaked:** `User count = 1` (the real owner only), `BeverageSale = 0`,
27 products, and **both value fingerprints still `91c0ca31…` / `b57a51bb…`** after all testing.
The existing customer Saif was used rather than creating a test customer, and was not modified.

---

## 8. Commit

```
8847fff  feat(db): Migration D — widen Product.stock to Decimal(10,2) for litres

  lib/api.ts                                  | 23 +++++++++--
  lib/sales.ts                                | 46 ++++++++++++++++++++--
  lib/serialize.ts                            |  2 +-
  prisma/migrations/.../migration.sql         | 22 +++++++++++
  prisma/schema.prisma                        | 29 +++++++++++---
  5 files changed, 109 insertions(+), 13 deletions(-)
```

**No credential committed** — `.env` confirmed still gitignored (`.gitignore:32`), and the staged set
is exactly the five files above. (A grep flagged one filename containing the word "credentials" — it
is the untracked doc `2026-08-12-s2-milk-split-BLOCKED-on-db-credentials.md`, not staged. False
positive.)

Not pushed; no instruction to.

---

## One thing that went wrong, and what it was

My first `ZZ_TEST_` attempt returned **400 "Invalid input"**. That was **my payload, not the code** —
`saleCreateSchema` requires `saleDate`, and I had omitted it. Adding it produced a clean 201. Worth
recording only because a 400 on a sale create right after a schema migration looks alarming and was
not related.

---

## Still open (unchanged by this turn, flagged not fixed)

**`lib/validations/sales.ts` types quantity as `.int()`**, so the API rejects `12.5` today. Migration
D makes the *storage* capable of fractional stock; the *validator* still has to be relaxed before a
milk line can actually be sold through the route. That is deliberately out of scope here — it lands
with the unified `/api/sales`, alongside milk `Product` creation and the delivery-to-stock bridge.

---

## State

| | |
|---|---|
| `HEAD` | **`8847fff`** (was `6f18b52`) |
| Migrations | **9 applied**, ending `20260812120000_widen_product_stock` |
| `Product.stock` | **`numeric(10,2)`**, all 27 rows `100.00`, values unchanged |
| Real data | 2 sales, Saif, farmer net owed Rs. 5,000 — **all reconciled** |
| RLS | 18/18 enabled |
| Build | tsc / lint / build all green |
| Working tree | clean apart from untracked `docs/responses/*.md` |

Migration D is done. The next stage in the unified-sale sequence is S3 (the unified `/api/sales`
endpoint), which is where the `.int()` validator, the milk `Product`, and the delivery-to-stock
bridge all become live concerns.
