# Post-restore verification — READ-ONLY

**Date:** 2026-08-12
**Scope:** verify the manual `psql` restore from `backup2.sql` (post-Migration-C dump) landed correctly.
**Writes performed:** **none.** No INSERT/UPDATE/DELETE/DROP/ALTER, no `migrate deploy/reset/dev/diff`,
no `db push`, no seed, no `ZZ_TEST_` rows, no `.env` change, no connection string passed to
`--shadow-database-url`.

## ✅ VERDICT: the restore is COMPLETE and CORRECT. Nothing is missing or wrong.

Every expected value matched, including **both product fingerprints reproducing their pre-wipe
baselines byte-for-byte**. Nothing needs fixing. Details below, then four notes that are expected
state rather than problems.

---

## 1. Row counts — 16/16 match

| Table | Expected | Actual | |
|---|---|---|---|
| `Product` | 27 | **27** | ✅ |
| `Customer` | 1 | **1** | ✅ |
| `User` | 1 | **1** | ✅ |
| `Sale` | 1 | **1** | ✅ |
| `SaleItem` | 1 | **1** | ✅ |
| `MilkSale` | 1 | **1** | ✅ |
| `BakerySale` | 1 | **1** | ✅ |
| `Farmer` | 1 | **1** | ✅ |
| `MilkDelivery` | 1 | **1** | ✅ |
| `FarmerPurchase` | 1 | **1** | ✅ |
| `Settings` | 1 | **1** | ✅ |
| `Category` | 2 | **2** | ✅ |
| `SubCategory` | 11 | **11** | ✅ |
| `BakerySaleItem` | (not listed) | **1** | ✅ the bakery sale's line |
| `BeverageSale` | (not listed) | **0** | ✅ correct — there never was one |
| `CustomerPayment` | (not listed) | **0** | ✅ correct — none recorded |

---

## 2. The real records are intact

| Check | Expected | Actual | |
|---|---|---|---|
| Customer | Saif | **Saif** | ✅ |
| User email | `i228767@nu.edu.pk` | **`i228767@nu.edu.pk`** | ✅ |
| User password hash | non-null | **non-null** (not printed) | ✅ |
| `BakerySale.totalAmount` | 5000.00 | **5000.00** | ✅ |
| `MilkSale.totalAmount` | 6000.00 | **6000.00** | ✅ |
| `Sale.totalAmount` | 5000.00 | **5000.00** | ✅ |
| `Sale.id` | — | **`cmsjh3kly0002uve8ajkvs2ji`** | ✅ matches the id CLAUDE.md records for Migration A's copied row |
| `SaleItem.quantity` | 100.00 | **100.00** | ✅ Migration C's decimal column |
| `SaleItem.moduleKey` | — | **`bakery`** | ✅ |
| Farmer | Saif | **Saif** | ✅ |
| `MilkDelivery` | 250 L @ 30000 | **250.00 L @ 30000.00** | ✅ |
| `FarmerPurchase` | 25000 | **25000.00** | ✅ |
| **Farmer net owed** | **5000** | **5000.00** | ✅ computed `30000 − 25000` |
| `prod_buns`, `prod_eggs` | both present | **both present** | ✅ |

### 🔑 The strongest evidence: both fingerprints reproduce exactly

| Fingerprint | Baseline | After restore | |
|---|---|---|---|
| `md5(id='stock' …)` — the expression I ran **minutes before the wipe** this session | `23cc9f6e0d2128de22ba7487473ea525` | **`23cc9f6e0d2128de22ba7487473ea525`** | ✅ |
| `md5(id\|name\|price\|stock\|isActive …)` — CLAUDE.md's documented product fingerprint | `95794a0bb44f1b15d541a60ef0bd5c51` | **`95794a0bb44f1b15d541a60ef0bd5c51`** | ✅ |

Two independently-derived checksums, computed against two different baselines recorded at two
different times, both reproduce. **All 27 products came back identical — ids, names, prices, stock
and active flags.** That is materially stronger than the row count on its own.

---

## 3. Migration history — 8 rows, none rolled back

Read from `_prisma_migrations`. No `migrate deploy` was run.

| # | Migration | Finished | Steps | Rolled back |
|---|---|---|---|---|
| 1 | `20260802201127_init` | 2026-08-02 20:11 | 1 | no |
| 2 | `20260803000000_enable_rls` | 2026-08-02 20:35 | 1 | no |
| 3 | `20260809000000_add_sale_discount_percent` | 2026-08-08 20:55 | 1 | no |
| 4 | `20260809120000_add_product_stock` | 2026-08-08 22:04 | 1 | no |
| 5 | `20260809180000_unify_sale_tables_part_a` | 2026-08-09 15:07 | 1 | no |
| 6 | `20260810120000_add_settings` | 2026-08-09 20:09 | 1 | no |
| 7 | `20260810180000_drop_product_discount_percent` | 2026-08-10 12:58 | 1 | no |
| 8 | **`20260811120000_widen_saleitem_quantity`** | 2026-08-11 16:55 | 1 | no |

✅ **8 rows, ending exactly where expected.**

**Worth noting:** the `finished_at` timestamps are the *original* application times (2–11 Aug), not
today's. A dump carries the table's contents rather than re-running the migrations, so this is
positive confirmation that the history was **restored** rather than re-applied — and it means
migration #5's timestamp still matches the `createdAt` on the `Sale` row it created.

---

## 4. Schema shape

| Column | Expected | Actual | |
|---|---|---|---|
| `SaleItem.quantity` | `numeric(10,2)` | **`numeric(10,2)`** NOT NULL | ✅ Migration C restored |
| `SaleItem.netLineTotal` | — | `numeric(10,2)` NOT NULL | ✅ |
| `SaleItem.moduleKey` | — | `text` NOT NULL | ✅ |
| **`Product.stock`** | **`integer`, default 100** | **`integer`** NOT NULL default `100` | ✅ **Migration D correctly NOT applied** |
| `Product.price` | — | `numeric(10,2)` NOT NULL | ✅ |
| `BeverageSaleItem.quantity` | — | `integer` | ✅ untouched by Migration C, as designed |
| `BakerySaleItem.quantity` | — | `integer` | ✅ same |

`Product.stock` being `integer` is the correct and expected outcome — the wipe happened *before*
Migration D was written, so there was nothing of it to restore.

### RLS — all 18 tables ENABLED. **No table is FALSE. No security gap.**

| Table | `relrowsecurity` | `relforcerowsecurity` | Policies |
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

**Nothing flagged.** This is exactly the posture CLAUDE.md documents as correct: RLS on, **zero
policies** (default deny for `anon`/`authenticated`), and `FORCE RLS` **off** on every table so
Prisma's table-owner connection is unaffected.

Supabase advisors confirm independently:

```
18 × rls_enabled_no_policy   at INFO      <- the documented healthy steady state
 0 × rls_disabled_in_public  at ERROR     <- the thing to watch for; absent
```

This resolves the security gap I reported after the wipe. The backup did re-enable RLS.

---

## 5. App connectivity — both connection strings work

**`DIRECT_URL` (:5432)** — via `prisma migrate status`, which reads `_prisma_migrations` and applies
nothing:

```
8 migrations found in prisma/migrations

Database schema is up to date!
```

**`DATABASE_URL` (pooled, :6543)** — a read-only `PrismaClient` query, the app's actual runtime path:

```
Product.count()              : 27
User row                     : i228767@nu.edu.pk
User.password non-null       : true   (hash NOT printed)
Sale                         : cmsjh3kly0002uve8ajkvs2ji @ 5000
SaleItem.quantity (Decimal)  : 100   module=bakery
```

✅ **The app can reach the database, and the `User` row with its password hash is present, so login
will work.** As instructed I did **not** sign in — that is the one item proven by inference
(connectivity + user row + non-null hash) rather than by execution. A single sign-in is the natural
first action whenever you next open the app.

*(The first round trip measured ~2.7s, but that includes connection establishment. It is the cold-connect
cost, not a regression — the documented steady-state figure is ~1.1s per query, unchanged.)*

---

## Four things that look like findings but are expected state

None of these is a restore defect. Listing them so they are not mistaken for one later.

1. **`Product.stock` is `integer`, and all 27 rows are `100`.** Migration D was never applied. The
   `100` is still the migration's temporary default, not a counted shelf — CHECKLIST #2 covers the
   owner entering real numbers at handoff.
2. **`Settings.configuredAt IS NULL`.** The shop-details placeholders are still in place, exactly as
   before the wipe. **CHECKLIST #2b remains open and is unaffected by any of this.**
3. **`BeverageSale` and `CustomerPayment` are empty.** Correct — neither ever had a row.
4. **`Sale` holds 1 row, `SaleItem` 1 row.** That is Migration A's copy of the bakery sale, carrying
   the original's id. It is *not* a second sale and *not* evidence of a live unified flow — CLAUDE.md
   calls this out specifically. The unified tables remain dormant.

---

## Where things stand

| | |
|---|---|
| Database | **fully restored and verified** — 27 products, 2 real sales, farmer balance Rs. 5,000, RLS on 18/18 |
| Migration history | 8 applied, ending `20260811120000_widen_saleitem_quantity` |
| App | reachable on both pooled and direct connections; login row intact |
| `HEAD` | `9b87dc4`, working tree clean, `tsc --noEmit` 0 errors |
| Migration D | **still not started** — no migration file written, nothing applied |

Nothing was fixed, changed, or written this turn. Whenever you want to pick Migration D back up, the
analysis from the incident report still stands — including the finding that it cannot be
code-neutral, because `SaleProduct.stock` is a hand-written `number` and `failStockBlocked` does not
run its payload through `serialize()`.
