# S4.2 — the unified till, its receipt, and the receivables bridge

**Date:** 2026-08-14 · **Result: 13/13 automated + a real browser pass.**
**Real data untouched** — 27-product fingerprint `b57a51bb…` identical, `prod_milk` 0.00, farmer net
owed 5,000, `Sale`/`SaleItem` back to 1/1. **No migration. No schema change.**

Also in this session, before S4.2: **S3's three regression-catchers re-verified 9/9** and a
**pre-existing 5s-transaction bug fixed** (commit `6cf7825`) — §1.

---

## 1. First: you asked whether the three regression-catchers still hold. They do — and re-running them found a real bug

My S4.1 test #18 only checked that the three old list endpoints return 200. **That is weaker than
S3's catchers**, so I re-ran the actual ones against the post-S4.1 build:

```
PASS  S3 #8  ALL-OR-NOTHING shortfall (unified POST)   Sale 1->1  SaleItem 1->1  bevSTOCK 1000->1000  bakSTOCK 1000->1000
PASS  S3 #21 shortBy.available is a NUMBER              typeof=number value=1000
PASS  S3 #17 OLD per-module create/decrement/delete/restore   bev 1000->998->1000 | bak 1000->997->1000
PASS  S3 #17b PATCH reconciles by DELTA, ignores client price stock 1000->988->992 (12->8 freed 4), unitPrice stayed 100 vs client 999
PASS  S3 #18  .int() still rejects 2.5; unified accepts 12.5  bev=400 bak=400 unified=201
PASS  S3 #9/#10 unified still rejects discountPercent (.strict)
PASS  New DELETE returns the 12.5 L to stock
PASS  REAL DATA untouched · PASS Cleanup back to baseline      9/9
```

**One of my own assertions was broken and I fixed it rather than banking the pass.** In #8 I spread
the row-count object over the stock readings, so `bev`/`bak` were silently overwritten by
`BeverageSale`/`BakerySale` counts — the "no stock moved" half asserted nothing. Corrected; the run
above compares actual stock.

### 🔴 The re-run exposed a pre-existing bug on the owner's main sale screen

One run of the beverages create failed. The dev log named the cause exactly:

```
Transaction API error: Transaction already closed ...
The timeout for this transaction was 5000 ms, however 5327 ms passed since the start (P2028)
```

`POST /api/{beverages,bakery}/sales` opened their transaction with **no options**, so they ran on
Prisma's **5s default** while doing a stock update, a nested create and a detail read-back — three
round trips at the ~1.1s floor from the region split (CHECKLIST #14). **A perfectly valid sale 500s.**
The PATCH routes and the unified POST have always set `{ timeout: 15_000, maxWait: 5_000 }`; the two
create routes now match. Pure timeout widening — the same rows commit, or none do. Fixed in
`6cf7825`, then the 9/9 above re-run clean.

*Worth noting how thin the evidence was:* 4 of 5 runs passed. Had I not looked at the server log, this
would have read as flakiness.

---

## 2. What shipped in S4.2

| File | Change |
|---|---|
| `app/(dashboard)/sales/page.tsx`, `sales/new/page.tsx` | **new** — the till and its list |
| `components/sales/UnifiedSaleForm.tsx` | **new** — one bill, any shop |
| `components/sales/UnifiedSalesList.tsx`, `UnifiedSaleLineItems.tsx` | **new** — list, expand, delete |
| `app/receipt/sale/[id]/page.tsx` + `loadUnifiedReceipt` | **new** — the unified receipt |
| `lib/receivables.ts` | **unified sales now counted**, migration-A copy excluded |
| `app/api/customers/[id]/route.ts`, `lib/receivables-display.ts`, `CustomerProfile.tsx` | unified bills in the purchase history |
| `lib/validations/sale-form.ts` | decimal-quantity schema beside the integer one |
| `components/sales/LineItemRow.tsx` | `showDiscount` flag (default = today's behaviour) |
| `lib/sale-catalog.ts`, `ProductPicker.tsx` | cross-category grouping + **search by product name** |
| `components/receipt/ReceiptDocument.tsx` | litres → `L`; Subtotal row only when it differs from TOTAL |
| `lib/nav.ts` | "Sales" in the sidebar |

### The receivables bridge, and the trap it walks past (D1)

Migration A copied the real bakery sale into `Sale` **keeping its id**. Summing both tables naively
bills the owner's one real customer twice:

```
correct : 5,000 (bakery) + 6,000 (milk)        = 11,000
naive   : 5,000 + 6,000 + 5,000 (the A copy)   = 16,000   ✗
```

`NOT_A_MIGRATION_COPY` — a `NOT EXISTS` pair — excludes any `Sale` whose id also exists in the old
tables. Exact rather than heuristic (a genuinely new bill gets a fresh cuid), and **self-healing**:
1 row today, 0 after S5, nothing to remember to undo. The ledger/activity path gets the exclusion for
**free** — that function already loads the customer's complete legacy sets, so their ids *are* the
exclusion list; no extra query, no raw SQL.

### Where I deviated from the plan, and why

**D3 said "parameterise the existing form"; I built a separate `UnifiedSaleForm` instead.** Three
things no flag removes: a different mutation hook (`useCreateUnifiedSale` vs `useCreateSale(module)`,
and hooks cannot be chosen from a config object), no discounts anywhere, and no `SaleModule` to pass
(its `key` is a ModuleKey and it carries an export type and a module accent — a cross-module bill has
none). Refactoring `NewSaleForm` would have put two shipped, browser-verified money screens at risk to
save one screen's shell. **Every primitive is still shared** — `ProductPicker`, `CustomerCombobox`,
`SaleDatePicker`, `StockBlockAlert`, `AnimatedMoney`, `LineItemRow`, the motion vocabulary — and the
form-state shape is deliberately identical so `LineItemRow` needs no cast.

---

## 3. Two real defects the testing found (both fixed)

**🥛 The milk rate was being truncated on the receipt.** The first printed bill read:

```
12.5 litres × 12… Rs. 1,500.00      <- the RATE is cut off at 32 characters
```

A truncated unit price is exactly the failure the paise rule exists to prevent — the customer cannot
check the arithmetic. Litres now print as `L`:

```
12.5 L × 120.00   Rs. 1,500.00
```

**🔎 The product picker could not be searched by product name.** Its match target was built from the
sub-category plus attributes, so a product whose name is not echoed by either was unreachable — the
picker said "No product found" for a product sitting in the list. Invisible on the seeded catalog
(where the sub-category IS the name: "Buns", "Pepsi"), immediately wrong on a till where the owner
types what is on the bottle. Now matched on label **+ product name**; display unchanged.

Both were found by *using* the thing, not by a build. Neither would have failed a type-check.

---

## 4. Test results

### Automated — 13/13

```
PASS  #1  Migration-A copy NOT double-counted (Saif = 11,000)     billed=11000
PASS  #2  Unified sale reaches the customer's balance             billed=2566.5 outstanding=2566.5
PASS  #3  Saif's balance unaffected by the test bill              billed=11000
PASS  #4  Customer profile shows it as a cross-shop bill          module=unified items=3 detail="Beverages · Bakery · Milk"
PASS  #5  Customer LIST balances agree with the profile           saif=11000 zz=2566.5   (two different code paths)
PASS  #6  Receipt: flat list, ONE total, milk rate not truncated
PASS  #7  No receipt line exceeds the roll width                  widest=32, limit=32
PASS  #8  Receipt prints PAISE (3 × 275.50 = 826.50)
PASS  #9  /sales and /sales/new render for a signed-in owner
PASS  #10 Signed out, /sales redirects to /login                  307 -> /login?callbackUrl=…
PASS  #11 DELETE restores the balance to 0 and the stock in full  bev/bak/milk all back to 1000
PASS  #12 REAL DATA untouched                                     fp=identical prod_milk=0.00 netOwed=5000
PASS  #13 Cleanup: every ZZ_TEST_ row removed                     Sale=1 Product=28 Customer=1 User=1
```

### Browser pass — the till driven by hand in Chrome

Not a build check. I rang up a real mixed bill on `/sales/new`:

| Step | Observed |
|---|---|
| Picker headings | **`Beverages · Coke Cola`**, `Bakery · Russ`, `Milk Shop · …` — category-qualified |
| Milk line | label **"Quantity (litres)"**, **"Price per litre"** pre-filled **120** from the catalog and editable, `12.5 litres · Line total Rs. 1,500` |
| Discount field | **absent**, as designed |
| Beverage line | 3 × 275.50 → **Rs. 827** on screen (the deliberate rounding) |
| Save | "Sale saved · Rs. 2,327", with **Print receipt** one tap away |
| Receipt | flat list, **no Subtotal row**, `3 × 275.50 Rs. 826.50`, `12.5 L × 120.00 Rs. 1,500.00`, **TOTAL Rs. 2,326.50** — paise, and it multiplies out |
| List | row showed **Beverages + Milk** chips; the migration-A row showed **Bakery** |
| Expanded row | each line tagged with its snapshotted module and a coloured dot |
| Delete | confirm dialog → row animated out → **stock verified back at 1000 / 1000 / 1000**, including the 12.5 L |

The screen/receipt split behaved exactly as documented: **Rs. 2,327 on screen, Rs. 2,326.50 printed.**

---

## 5. Build

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `next lint` | ✅ no warnings or errors |
| `npm run build` | ✅ Compiled successfully — `/sales`, `/sales/new`, `/receipt/sale/[id]` all present |
| Edge-bundle guardrail | ✅ **0 hits**, production `middleware.js` (234.6 KB), dev server stopped first |

⚠️ **One loose end, stated rather than hidden:** the build printed `⚠ Compiled with warnings` in its
client phase alongside `✓ Compiled successfully`. I did not capture the warning text before you asked
me to stop rebuilding, so **I do not know what it says or whether it predates this work.** `tsc` and
lint are both clean. One `npm run build` will surface it.

---

## 6. What is deliberately NOT here

- **Reports still read the old tables** (D5) — a unified sale is in balances and on a receipt but in
  **no report figure** until S6. Now stated plainly in CLAUDE.md rather than left to be discovered.
- **No edit/PATCH** (D4) — CHECKLIST #8, unchanged.
- **The milk cutover** (S4.3) — `/milk/sales` still works as before and milk stock still reads HIGH.
- **`prod_milk.price` still 0** (D6) — your number to set; the till lets you type the rate meanwhile.
- **`buildLedger`'s unified branch and `getTotalOutstanding` are compiled but UNEXERCISED**: no
  endpoint renders a customer ledger today, and no route calls `getTotalOutstanding`. The two paths
  that *are* live — `getCustomerBalance` and `getCustomerBalances` — are covered by tests #1–#5.

---

## 7. Next

**S4.3 — the milk cutover.** `/milk/sales` becomes read-only history (your real Rs. 6,000 sale stays
visible), milk selling moves onto the till, milk stock becomes authoritative, and the provisional
warnings come out of `CLAUDE.md`, `lib/milk-stock.ts` and `REMAINING-WORK.md` in the same commit.

**One thing to decide before S4.3:** whether you intend to enter real sales before S6 lands. If yes,
the reports blind spot matters and S6 should come first.
