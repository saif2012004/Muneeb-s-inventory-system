# S2 — milk-sale split verified and committed

**Date:** 2026-08-12
**Commit:** `9b87dc4` — pushed to `main`
**Result:** connectivity restored, full browser gate passed, split committed. No credentials in git.

---

## STEP 1 — Connectivity confirmed

```
$ npx prisma migrate status
Datasource "db": PostgreSQL database "postgres" at aws-1-ap-northeast-2.pooler.supabase.com:5432

8 migrations found in prisma/migrations

Database schema is up to date!
```

**Connected, all 8 migrations applied, no drift.** The new password took, on both URLs — sign-in
through the app also worked (`303 → /`), which exercises `DATABASE_URL` (pooled) rather than
`DIRECT_URL`, so both are good.

The staged split was still intact and unchanged from the blocked run: `computeMilkSaleTotal` still
byte-identical to `HEAD`, 16 farmer exports still in `lib/milk.ts`.

---

## STEP 2 — Browser verification: **every item passed**

Baseline captured before touching anything, and re-checked after.

### Farmer surfaces — all five, each checked individually

| Surface | Route | Result |
|---|---|---|
| Milk hub | `/milk` | **200** |
| Quick entry | `/milk/quick-entry` | **200** |
| Balance sheet | `/milk/balances` | **200** |
| Farmer profile | `/milk/farmers/cmsjh57qz…` | **200** |
| Milk sales list | `/milk/sales` | **200** |

Loading is the weak check, so I read what each actually computes:

**1. Farmer balances + balance sheet** — `/api/milk/farmers`

```
farmer: Saif | milkValue 30000 | purchases 25000 | NET OWED 5000
summary: farmerCount 1, totalMilkValue 30000, totalPurchases 25000,
         totalLiters 250, totalOwedToFarmers 5000, totalAdvanced 0
```

✅ **Farmer net owed is still Rs. 5,000**, and owed/advanced are still reported separately rather
than netted.

**2. Farmer profile + ledger** — `/api/milk/farmers/[id]`

```
balance   : milkValue 30000 | purchases 25000 | NET OWED 5000
deliveries: 1 -> (250 L, 30000)
purchases : 1 -> ("biscuits", 25000)
LEDGER    : 2 entries, running balance -> [30000, 5000]
```

✅ The running balance walks `30,000 → 5,000` exactly as before.

**3. Quick entry** — `/api/milk/deliveries/quick-entry?date=2026-08-08`

```
Saif — morningLiters 100, eveningLiters 150, ratePerLiter 120,
       totalLiters 250, totalAmount 30000, suggestedRate 120
```

✅ This is the path that consumes `DELIVERY_SELECT` and `computeDeliveryTotals` — the farmer half of
`lib/milk.ts` — and it is unchanged. Morning and evening are still distinct values, not collapsed.

**4. Milk sales list** — `/api/milk/sales`

```
sales: 1 -> (50 L, 120, 6000)      totals: liters 50, amount 6000
```

✅ This reads `MILK_SALE_SELECT` **from the new file** and returns the same figures.

### Milk SHOP sale path still records — through the moved code

Created one `ZZ_TEST_` sale via `POST /api/milk/sales`, which calls `computeMilkSaleTotal` from
`lib/milk-sales.ts`:

```
12.5 L × Rs. 118  ->  TOTAL 1475      correct: True
```

Confirmed in the database, not just the response:

```
liters 12.50 · ratePerLiter 118.00 · totalAmount 1475.00
```

A deliberately awkward pair — 12.5 litres is exactly the decimal case Migration C widened the column
for, and `12.5 × 118` is the kind of arithmetic that lands a few paise off in floats. It came out
exact.

Then **deleted through the app's own DELETE route** (`200`), not by raw SQL — so the delete path was
exercised too.

### Data reconciled after — everything matches baseline

| | Baseline | After |
|---|---|---|
| Farmer | Saif | Saif |
| `MilkDelivery` | 250.00 L @ 30,000.00 | **same** |
| `FarmerPurchase` | 25,000.00 | **same** |
| **Farmer net owed** | **Rs. 5,000** | **Rs. 5,000** ✅ |
| `MilkSale` | 1 @ 6,000.00 | **same** |
| `BakerySale` | 1 @ 5,000.00 | **same** |
| `BeverageSale` | 0 | **same** |
| `Customer` | 1 (Saif) | **same** |
| `Product` fingerprint | `95794a0b…` | **identical** |
| `SaleItem.quantity` | 100.00 | **same** |
| `User` | owner only | **same** |

`ZZ_TEST_` user and customer removed. **No farmer table was ever written to** — every farmer check
was a read.

---

## STEP 3 — Committed

```
9b87dc4  refactor: split milk-sale code out of lib/milk.ts (isolate from farmer code)
         4 files changed, 57 insertions(+), 29 deletions(-)

  app/api/milk/sales/[id]/route.ts     import path
  app/api/milk/sales/route.ts          import path
  lib/milk-sales.ts                    NEW — the 2 moved exports
  lib/milk.ts                          2 blocks removed; 16 farmer exports intact
```

### No credentials committed

| Check | Result |
|---|---|
| `.env` or anything credential-shaped staged | **NONE** ✓ |
| `.env` still gitignored | **IGNORED** ✓ |
| Files in the commit | exactly the four above — verified with `git show --name-only` |

The `/*.sql`, `/*.dump`, `/*.backup` and `supabase/.temp/` guards added during S1 remain in place.

---

## What S2 achieved

**The farmer boundary is now structural rather than a comment.** `lib/milk-sales.ts` cannot import
`lib/milk.ts` and vice-versa — verified in both directions. When S3/S4 build the unified checkout
and absorb the milk shop sale, the farmer balance, ledger and purchase flow are in a file that work
has no reason to open.

Worth restating because it is the whole point of the stage: **the two moved exports touch no farmer
table and make no database call.** `MILK_SALE_SELECT` is a select shape; `computeMilkSaleTotal` is
`liters × rate` on `Decimal`. The 16 farmer exports — including everything that reads
`milkDelivery` and `farmerPurchase` — never moved.

---

## Constraint compliance

| Constraint | Status |
|---|---|
| No logic changes beyond the staged move | ✅ both blocks byte-identical to `HEAD` |
| No farmer code touched | ✅ 16 exports unmoved, bodies unedited, farmer data read-only and reconciled |
| No schema, no migration, no `Sale`/`SaleItem` work, no stock bridge | ✅ |
| Never commit `.env` or connection strings | ✅ verified staged set and ignore status |

---

## Where the project stands

**Done:** S1 (Migration C — decimal quantity, `"milk"` module value) and S2 (milk-sale code
isolated from farmer code).

**Next is S3** — the unified `/api/sales` endpoint reusing `lib/sales.ts`'s money helpers, with milk
lines skipped by the stock reconciliation. Nothing is removed at S3; both old and new paths stay
live.

**Still open before S3/S4 can be designed properly**, from the design doc and S1:

- **Q3** — how the owner enters a milk line (picker entry vs a separate control)
- **Q1** — whether a mixed receipt needs per-category subtotals
- A milk `Product` needs a **third `Category`** (only Bakery and Beverages exist), and
  `Product.stock` defaults to **100**, which is meaningless for milk until the stock bridge lands

**Also worth doing while it is fresh:** the rotated password is now in local `.env` and Vercel, but
if it is not recorded anywhere durable, the next rotation repeats today's outage. That is a
handoff-item concern rather than a code one.
