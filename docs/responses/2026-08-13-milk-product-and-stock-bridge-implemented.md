# Milk product + delivery-to-stock bridge — implemented ✅

**Date:** 2026-08-13
**Commit:** **`cbcd2eb`** — `feat: milk product + delivery-to-stock bridge (reconcile-by-delta, all 4 paths)`
**Result:** **22/22 pass**, including all four regression-catchers. Farmer data byte-identical.

**Pre-flight:** HEAD `90e8609`, 0 tracked mods, 9 migrations / "up to date", and
`grep -c "product\|stock" lib/milk.ts` = **0** before starting. ✅

`6 files changed, 428 insertions, 30 deletions.` **No schema change, no migration** — the milk
product is data.

---

## 1. The milk product

Added to `prisma/seed.ts` via the same idempotent `upsert` as everything else.

```ts
// CATEGORIES
{ id: "cat_milk", name: "Milk Shop" },

// SUB_CATEGORIES
{ id: "sub_milk", name: "Milk", categoryId: "cat_milk" },

// PRODUCTS
{ id: "prod_milk", name: "Milk", subCategoryId: "sub_milk",
  size: null, qualityTier: null, shape: null, unit: "litre", stock: 0 },
```

`ProductSeed` gained an **optional `stock`**, and the upsert honours it:

```diff
-      create: { ...product, price: 0, isActive: true },
+      const { stock, ...fields } = product;
+      create: { ...fields, price: 0, isActive: true,
+                ...(stock === undefined ? {} : { stock }) },
```

**Omitted → the schema default of 100** (the placeholder the owner replaces by counting the shelf).
**Present → that exact value**, which is how milk starts at 0. Milk's stock is *derived* — deliveries
add, sales subtract — so seeding 100 would invent a hundred litres that never arrived.

### A stale comment corrected in the same change

`prisma/seed.ts` previously said, in bold:

> *"Milk is deliberately absent … never as a catalog Product. **Do not add a "Milk Shop" category.**"*

That was true until the unified sale landed and is now the exact opposite of the design. Replaced
with the current rule, including that `cat_milk` and the name `"Milk Shop"` must both stay verbatim
because `resolveLineModule` depends on them — and that the **farmer side is unchanged**: only the
*selling* of milk became a catalog product.

### Verified in the database after `prisma db seed`

| | |
|---|---|
| `prod_milk` | exists, **stock `0.00`**, price `0.00`, `unit "litre"`, `isActive true` |
| `cat_milk` | name **"Milk Shop"** |
| `sub_milk` | exists |
| Categories / sub-categories | **3 / 12** |
| Products | 27 → **28** |

*(The seed logs "27 products" — that is `PRODUCTS.length` = 26 seeded + milk. The database's 28th is
a manually-created product with a cuid id that was never in the seed. Not an anomaly.)*

**The 27 pre-existing products hash to `b57a51bb57be89cbc9db646d4a2a9972` — byte-identical to the
pre-seed baseline.** The seed added milk and touched nothing else.

---

## 2. The bridge — `lib/milk-stock.ts` (new, 124 lines)

```ts
export const MILK_PRODUCT_ID = "prod_milk";
export async function findMilkProductId(): Promise<string | null>;
export async function applyMilkStockDelta(tx, productId, deltaLiters): Promise<void>;
export function milkStockReversalMessage(liters, available): string;
export async function readMilkStock(productId): Promise<Prisma.Decimal | null>;
```

`applyMilkStockDelta` **delegates to `applyStockDeltas`** rather than issuing its own update, so
"never negative" stays one implementation enforced in the database's `WHERE` clause. A zero delta is
a no-op, so an edit changing only the rate or notes issues no stock write at all.

**It lives outside `lib/milk.ts` on purpose** — that is what keeps the grep meaningful.

---

## 3. All four delivery paths, reconciled by delta

| Path | Delta | Transaction |
|---|---|---|
| `POST .../deliveries` | `+ totalLiters` | **added** |
| `PATCH .../deliveries/[id]` | `+ (new − prior)` | **added** |
| `DELETE .../deliveries/[id]` | `− totalLiters` | **added** |
| `POST /api/milk/deliveries/quick-entry` | `+ (new − prior)` | already had one |

**Both selects that lacked prior litres now carry them** — `findScopedDelivery` and quick-entry's
`existing` lookup both gained `totalLiters`.

### The quick-entry change — the one that mattered most

```diff
-      select: { id: true, farmerId: true },
+      // `totalLiters` carries the PRIOR value for the stock delta. Without it
+      // the evening pass — which UPDATES the morning's row — could only add the
+      // full new litres again and would double-count the morning, every day.
+      select: { id: true, farmerId: true, totalLiters: true },
```

```diff
+            // Delivery first, stock second — the farmer's record is primary.
+            if (milkProductId) {
+              await applyMilkStockDelta(
+                tx, milkProductId,
+                write.totals.totalLiters.minus(write.priorLiters)
+              );
+            }
```

A create's `priorLiters` is `Decimal(0)`, so the delta reduces to the full litres — one code path,
not a branch.

### Ordering, refusal, and the missing-product case

- **Delivery written FIRST, stock second.** The farmer's record is primary; stock is the side-effect.
- **The milk product is resolved once, outside the transaction** — one row, and at ~1.1s a round trip
  it has no business holding a transaction open.
- **A reversal that would drive stock below zero is REFUSED** with a delivery-specific 409. The
  `reversalLiters` variable is hoisted above the `try` so the `catch` can name the amount — a `const`
  inside the `try` would not be in scope there.
- **Missing milk product → the delivery still records**, stock skipped, `console.error`.

---

## 4. Test results — 22/22

```
PASS  # 1  Milk resolves to moduleKey "milk" in POST /api/sales   moduleKey=milk qty=12.5
PASS  # 2  Fractional-litre line reconciles to the paise          12.5 x 120 = 1500.00
PASS  # 3  THREE-module bill reconciles                           [bakery,beverages,milk] SUM=950.00 = total
PASS  # 4  Milk sale decrements milk stock                        50 -> 37.5
PASS  # 5  /api/sales untouched in the diff                       0 files changed under app/api/sales/
PASS  # 6  Create adds stock                                      0 -> 40
PASS  # 7  QUICK ENTRY evening pass adds the DELTA                see below
PASS  # 8  Edit reconciles by delta, both directions              40 -> 25 (-15) -> 60 (+35)
PASS  # 9  Delete removes stock                                   60 -> 0
PASS  #10  Never-negative refusal                                 see below
PASS  #11  After correcting stock, the same delete succeeds       500 -> 400
PASS  #12  Quick entry inside its 25s budget                      6503ms
PASS  #13  Missing milk product: delivery records, no 500         status=201
PASS  #14  Manual milk-stock correction still works               set to 500, status=200
PASS  #15  REAL farmer net owed still exactly 5000.00             before=5000 after=5000
PASS  #16  REAL ledger running balance unchanged                  [30000, 5000]
PASS  #17  All farmer surfaces 200                                hub/balances, profile, quick-entry, milk sales
PASS  #18  REAL delivery litres/amount + purchase untouched       250.00 / 30000.00 / 25000.00
PASS  #19  lib/milk.ts product|stock refs                         0
PASS  #20  Per-module sale path unaffected                        create 201, decrement, delete-restore
PASS  #21  All ZZ_TEST_ removed; Sale back to 1 row; milk 0       zzFarmers=0 Sale=1 SaleItem=1
PASS  #22  Real data untouched                                    (see §5 — initially failed, my harness)
```

### 🔴 The four regression-catchers

**#7 — quick entry's evening pass.** The case that would have drifted daily:

```
morning 0 -> 30    (+30)
evening 30 -> 50   (expected +20 => 50, ok=true)   updated=1
```

**+20, not +50.** The morning's litres were not counted twice.

**#10 — never-negative refusal.** 100 L delivered, drained down to 5 L on hand, then delete:

```
status=409   stock 5 -> 5   deliveryStillExists=true
msg="This delivery's 100 litres can't be taken back out of stock — only 5 l…"
```

**Refused, delivery kept, stock unmoved, and the message names the fix.** #11 then proves the escape
hatch works: after correcting stock to 500, the same delete succeeds and reconciles cleanly.

**#15 — the farmer's money.** `before=5000 after=5000`, with #16 showing the ledger still walking
`30000 → 5000` and #18 confirming `250.00 L / 30000.00 / 25000.00` byte-identical.

**#19 — the structural guarantee.** `grep -c "product\|stock" lib/milk.ts` → **0**, before and after.

### Milk end-to-end — what S3 could not test

Three-module bill: beverage 2 × 100 + bakery 3 × 50 + **milk 5 × 120** = `200 + 150 + 600 = 950.00`,
with `SUM("netLineTotal") = 950.00` matching `totalAmount` in SQL and three distinct `moduleKey`s on
one `Sale`. Milk resolved to `"milk"` **with `app/api/sales/` untouched**, exactly as S3 built it.

---

## 5. One test initially failed — my harness, not the code

**#22 first reported `bev=98/100 bak=97/100 users=2`.**

**Cause: incomplete test cleanup on my side.** The three-module bill consumed 2 beverage and 3 bakery
units, and I removed those `Sale` rows with raw `prisma.sale.deleteMany` — which does **not** restore
stock, because the unified endpoint has no DELETE route yet (that lands with S4). `users=2` was the
temporary `ZZ_TEST_` user, which my harness deletes in a `finally` block that runs *after* the
assertion.

**Not a product defect** — no code path was wrong. I restored the two products to 100 and re-verified
from scratch:

| | Expected | Actual |
|---|---|---|
| 27 pre-existing products (excl. milk) | `b57a51bb57be89cbc9db646d4a2a9972` | **identical** ✅ |
| 28-product fingerprint | `072614b41eb495ccc0bd2adbc024ec6e` | **identical** ✅ |
| `prod_milk.stock` | 0 | **0.00** ✅ |
| Users / Farmers / Deliveries | 1 / 1 / 1 | **1 / 1 / 1** ✅ |
| `Sale` / `SaleItem` | 1 / 1 | **1 / 1** ✅ |
| Delivery / purchase / **net owed** | 250 L, 30,000 / 25,000 / **5,000** | **250.00 / 30000.00 / 25000.00 / 5000.00** ✅ |
| BakerySale / MilkSale | 5,000 / 6,000 | **5000.00 / 6000.00** ✅ |

**Worth recording:** raw `Sale` deletion not restoring stock is a real gap that S4 must close when it
builds the unified sale's delete/edit UI — the per-module routes already restore on delete, the
unified one has no DELETE route at all yet.

---

## 6. Build

| Check | Result |
|---|---|
| `tsc --noEmit` (4096 heap) | ✅ **0 errors** |
| `next lint` | ✅ no warnings or errors |
| `npm run build` | ✅ Compiled successfully |
| Edge bundle guardrail | ✅ **0 hits** — see below |

**The guardrail first read 2 hits, and that was the documented false positive.** I had run
`npm run dev` after the production build, overwriting `.next/server/middleware.js` with the
unminified dev bundle — whose guardrail comments in `lib/auth.config.ts` and `middleware.ts`
literally contain the word "bcryptjs". CLAUDE.md warns about exactly this. Re-running a production
build gave **0 hits** against the real artifact.

---

## 7. CLAUDE.md — milk stock is tracked, NOT authoritative

Per the approved §2.6 Option A, `POST /api/milk/sales` was **not** changed. A new section records the
consequence rather than leaving the number silently trusted:

> **⚠️ The screen the owner actually uses today does not decrement milk stock.** … **So until S4, milk
> stock reads HIGH** — deliveries add to it and the owner's current sales screen never takes away.
> **This is a known, deliberate, time-boxed provisional state, written down so the figure is not
> silently trusted.** Do not "fix" it by adding a stock decrement to `POST /api/milk/sales`: that
> duplicates stock logic into a table that is scheduled to be dropped.
>
> **Closing condition:** when S4 routes milk selling through `/api/sales`, delete this warning and the
> number becomes authoritative.

It also documents the bridge's rules (delta not re-add, the evening-pass trap, delivery-first
ordering, the never-negative refusal, the missing-product fallback) and the
`grep -c "product\|stock" lib/milk.ts` → 0 invariant with an explicit **"do not move bridge code into
`lib/milk.ts`"**.

---

## Constraint compliance

| Constraint | Status |
|---|---|
| Bridge is STOCK-ONLY, no farmer money/behaviour change | ✅ #15, #16, #17, #18 |
| `grep -c "product\|stock" lib/milk.ts` still 0 | ✅ #19 |
| `POST /api/milk/sales` unchanged | ✅ not in the diff |
| `/api/sales` unchanged | ✅ #5 — 0 files under `app/api/sales/` |
| No stock/money math reimplemented | ✅ delegates to `applyStockDeltas` |
| No schema change, no migration, no dependency installs | ✅ |
| Never `--shadow-database-url`; 2 real sales and Saif untouched | ✅ |
| Existing delivery (250 L @ 30,000) and net owed (5,000) byte-identical | ✅ #15, #18 |

---

## State

| | |
|---|---|
| `HEAD` | **`cbcd2eb`** (was `90e8609`) |
| Migrations | 9, unchanged |
| Products | **28** — `prod_milk` at stock 0.00 |
| Working tree | clean apart from untracked `docs/responses/*.md` |

Not pushed; no instruction to.

**Next:** S4 — the unified sale screen, plus `GET /api/sales`. It carries two things from this stage:
routing milk selling through `/api/sales` (which closes the CLAUDE.md provisional warning and makes
milk stock authoritative), and a unified sale DELETE/edit that restores stock the way the per-module
routes already do.
