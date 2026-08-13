# S6 — reports read the unified tables. The last blind spot is closed.

**Date:** 2026-08-14 · **Result: 12/12.** No migration, no schema change.
**Real data untouched** — fingerprint `b57a51bb…` identical, `prod_milk` 0.00, farmer net owed 5,000.

Every figure the owner can see now counts a till bill: revenue, counts, trend, top products, the
receipt, the customer's balance, and the CSV exports.

---

## 1. The number that had to stay right

The whole risk in this stage is **double counting**. Migration A copied the real Rs. 5,000 bakery
sale into `Sale` keeping its id, so any total that adds `Sale` to the old tables reports it twice.
The first two tests pin that down before anything else runs:

```
PASS  #1  Baseline: migration-A copy NOT double-counted   bakery=5000 bev=0 milk=6000 total=11000
PASS  #2  Baseline: the bakery sale is counted ONCE       salesCount=1
```

The rule that makes it true — `NOT_A_MIGRATION_COPY` — **now lives in one place**
(`lib/unified-sales.ts`) and is imported by both `lib/receivables.ts` and `lib/reports.ts`. It was
written twice for a few hours in S4.2; a rule with two copies is a rule that will eventually disagree
with itself about the owner's money.

---

## 2. What each figure means now

| Figure | Before | Now |
|---|---|---|
| Module revenue | `SUM(totalAmount)` on the old table | **old table + `Σ netLineTotal` by `moduleKey`** |
| Module sale count | rows in the old table | **+ `COUNT(DISTINCT Sale.id)`** touching that module |
| Litres sold | `SUM(MilkSale.liters)` | **+ `Σ quantity`** on milk lines |
| Trend | old table only | **`UNION ALL` of both**, one round trip |
| Top products | the two old item tables | **both + `SaleItem`**, and **milk works for the first time** |
| CSV | per-module dumps | **+ `sales`** (one row per bill) **+ `product_sales`** (#20) |

**Per-module revenue is `Σ netLineTotal`, never the bill's `totalAmount`.** A bill holding beverages
and milk contributes its beverage lines to beverages and its milk lines to milk. Summing
`totalAmount` per module would count that bill once in each and make the shops add up to more than
the business took — test #4 asserts the modules sum *exactly* to the combined total.

**A mixed bill is ONE sale in each shop it touches**, via `COUNT(DISTINCT s.id)` — not one per line.
Worth stating because it means the per-module counts do not add up to "bills rung", and shouldn't be
presented as if they did.

### The query budget did not move

Everything is a `UNION ALL` inside the existing statement rather than a second query merged in JS:

- **summary**: still **1 round trip** (eight more scalar subqueries in the same statement)
- **trend**: still **1**
- **top products**: still **2** (grouped scan + name lookup)

At ~1.1s per round trip that is the difference between a dashboard that paints and one that trips the
15s client timeout — the failure this file's design already exists to avoid.

---

## 3. Per-product visibility (#20) — partly shipped

`getProductSales()` groups by **(product, `moduleKey`)** across the old item tables and `SaleItem`,
so the owner can see how much of each product sold — **with milk as its own line**, because the rows
carry the snapshot rather than the product's current category.

Shipped today as the **`product_sales` CSV export**, and `top-products` now accepts `module=milk`,
which it never could before (a `MilkSale` had no product to group by):

```
PASS  #7  Top products now works for MILK        rows=1 qty=12.5 revenue=1500
PASS  #10 product_sales: milk on its own line    "ZZ_TEST_S6 Milk,Milk,litre,12.5,1500"
```

**What remains: the on-screen per-product table.** The data and the query exist; the reports UI has
not been given a place to show them. That is the honest state of #20 — tracked in CLAUDE.md and
REMAINING-WORK.md rather than claimed as done.

---

## 4. Test results — 12/12

```
PASS  #1  Baseline: migration-A copy NOT double-counted in revenue   5000/0/6000/11000
PASS  #2  Baseline: the bakery sale is counted ONCE                  salesCount=1
PASS  #3  A till bill lands in EVERY module's revenue, split by line bev=300 bak=5240 milk=7500 total=13040
PASS  #4  Modules sum to the combined total                          300 + 5240 + 7500 = 13040
PASS  #5  ONE mixed bill = ONE sale in each module it touches        bev=1 bak=2 litres=62.5 (50 old + 12.5 till)
PASS  #6  Trend includes unified lines and matches the summary       trend=7500 summary=7500
PASS  #7  Top products now works for MILK                            qty=12.5 revenue=1500
PASS  #8  Top products merges OLD + unified for bakery               2 rows, 5240 (5000 old + 240 till)
PASS  #9  export type=sales: one row per bill, A-copy excluded       1 row + shops column
PASS  #10 export type=product_sales: MILK ON ITS OWN LINE (#20)      4 product rows
PASS  #11 Deleting the bill returns every figure to baseline         back to 11000
PASS  #12 Real data untouched                                        fp=identical prod_milk=0.00 netOwed=5000
```

The test bill was deliberately mixed — 3 × 100 beverages + 2 × 120 bakery + 12.5 L × 120 milk — so
every assertion is about a bill that belongs to three shops at once, which is the case the old
reporting could not express at all.

**One harness note:** my first run failed because I invoked the endpoints with `period=all`, which is
not a valid period (`today | week | month | year`). That was my error, not the code's — the routes
correctly rejected it.

---

## 5. Build

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `next lint` | ✅ no warnings or errors |
| `npm run build` | ✅ exit 0, compiled successfully |
| Edge-bundle guardrail | ✅ **0 hits**, production `middleware.js` (234.6 KB) |

The only build warning remains the pre-existing `jose`/`CompressionStream` one from Auth.js's JWT
library, identified in S4.3 and unrelated to any of this.

---

## 6. Where the project stands

**The unified rework is now functionally complete for daily use.** A bill can hold anything, prints
correctly, moves stock, lands on the customer's balance, and shows up in every report.

Remaining, in the order I would take them:

1. **S5 — migrate the 2 real sales** into `Sale`/`SaleItem` (gated; touches real money). Doing this
   also retires the dedupe filter, since the duplicate disappears.
2. **The on-screen per-product table** — the rest of #20.
3. **CHECKLIST #8 — the unified edit/PATCH screen.**
4. **S7** (cooling charge, billing-time price override), **S8** (multi-unit products), **S9** (remove
   the old paths, then Migration B).
5. **Go-live checklist** — real shop details, real opening stock counts, Vercel/Supabase Pro, region
   co-location.
