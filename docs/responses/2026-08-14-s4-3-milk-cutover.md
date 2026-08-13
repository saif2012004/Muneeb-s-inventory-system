# S4.3 — the milk cutover. Milk stock is now authoritative.

**Date:** 2026-08-14 · **Result: 8/8**, including an end-to-end proof on the **real `prod_milk`**.
**S4 is complete** (S4.1 · S4.2 · S4.3). No migration, no schema change.
**Real data untouched** — fingerprint `b57a51bb…` identical, `prod_milk` back at **0.00**, farmer net
owed 5,000, the real Rs. 6,000 milk sale still listed and still editable.

---

## 1. What changed

| File | Change |
|---|---|
| `components/milk/MilkSalesList.tsx` | "Record sale" → **link to the till**; cutover banner; dialog is **edit-only** |
| `components/milk/MilkHub.tsx` | the Milk-sales tile now says what its figures mean after the move |
| `app/api/milk/sales/route.ts` | docblock: **POST retired from the UI**, retires for real at S9 |
| `lib/milk-stock.ts` | the ⚠️ provisional warning **replaced** by the authoritative statement + its caveat |
| `CLAUDE.md` · `REMAINING-WORK.md` | same, plus S4 marked done |

**`/milk/sales` is now a history screen.** It keeps every milk sale recorded before the move —
including the owner's real **Rs. 6,000 / 50 L** one — and can still **edit, delete and export** them.
What it cannot do is create one.

**Edit and delete stay deliberately.** These rows are the owner's real records; removing the ability
to fix a typo would strand him with a wrong number he can see and cannot touch. Editing one moves no
stock, exactly as before — `MilkSale` never had a product link.

**`POST /api/milk/sales` is left in place and unreachable.** All the per-module paths retire together
at S9 after a soak; removing one early would make that rollback partial. The docblock says so, and
says not to add a stock decrement there.

---

## 2. Milk stock is authoritative — proved, not asserted

Both directions are now covered, and nothing can move milk without moving stock:

| Event | `prod_milk.stock` |
|---|---|
| Farmer delivery recorded / edited / deleted | **+ / delta / −** the litres (the bridge) |
| Milk line on the till | **−** the litres sold |
| A unified bill deleted | **+** the litres restored |
| ~~A sale on `/milk/sales`~~ | **cannot happen any more** |

**The end-to-end test used the REAL `prod_milk`**, not a stand-in, because that is the only thing
that proves the claim. Stock was lifted 0 → 5, sold through the till, the bill deleted, and stock put
back to 0 — every step asserted:

```
PASS  #1  /milk/sales is history-only (no create, links to till)   hasRecordSale=false linksToTill=true
PASS  #2  The real Rs. 6,000 milk sale is still there              total=6000 rows=1
PASS  #3  A till sale of milk DECREMENTS real prod_milk stock      stock 5 -> 2.5 (sold 2.5 L) moduleKey=milk
PASS  #4  Deleting the bill restores the litres                    stock 2.5 -> 5
PASS  #5  Milk stock can never go negative (409, nothing moved)    short=94 stock=5
PASS  #6  prod_milk restored to its documented starting value      stock=0 (was 0)
PASS  #7  POST /api/milk/sales still exists (400, not 404/405)     unreachable from the UI, retires at S9
PASS  #8  Real data untouched (fingerprint, farmer, sale counts)   fp=identical Sale=1 MilkSale=1 netOwed=5000
```

Browser-checked too: the banner reads *"Milk sales are now recorded on the till"* with a link, the
Rs. 6,000 row sits below it with its edit and delete controls, and Export is untouched.

### ⚠️ The one caveat, and it is about the opening number

`prod_milk.stock` **starts at 0**, and the real 250 L delivery **predates the bridge**, so it was
never added. Every movement since the bridge is correct; the starting point is not a count of the
fridge. **The owner sets the true opening litres at handover**, exactly as for every other shelf
count (CHECKLIST #2). Until then the figure is a running total from zero, not an inventory — written
into `CLAUDE.md` and `lib/milk-stock.ts` rather than left implied.

---

## 3. Build

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `next lint` | ✅ no warnings or errors |
| `npm run build` | ✅ exit 0, compiled successfully |
| Edge-bundle guardrail | ✅ **0 hits**, production `middleware.js` (234.6 KB) |

**The build warning I flagged as unidentified in S4.2 is now identified, and it is not ours:**

```
./node_modules/jose/dist/webapi/lib/deflate.js
A Node.js API is used (CompressionStream at line: 10) which is not supported in the Edge Runtime.
```

`jose` is Auth.js's JWT library, pulled into the Edge middleware bundle; the flagged path is JWE
compression, which this app never uses. It comes from `node_modules`, predates all of S4, and no file
I touched imports it. Left alone.

---

## 4. Where the project stands

**S4 is done.** The till sells everything, one bill; the receipt prints flat with one total; the
customer's balance is right; deleting a bill restores stock; milk stock is trustworthy.

**Still open, in the order I would take them:**

1. **S6 — reports.** The one real gap: `lib/reports.ts` and the CSV export still read the old tables,
   so **a till sale appears in no report figure**. This also matters more now: milk revenue on the
   dashboard stops growing at the cutover, since new milk sales are unified rows.
2. **S5 — migrate the 2 real sales** into `Sale`/`SaleItem` (gated, real money).
3. **CHECKLIST #8 — the unified edit/PATCH screen.** A wrong bill is currently deleted (stock
   restored) and re-rung.
4. Then S7 (cooling charge, price-override field), S8 (multi-unit), S9 (remove old paths).

**My recommendation: S6 next.** It is now the only thing standing between the owner and a set of
screens that agree with each other — and the longer real sales are entered before it lands, the more
history is missing from the reports when it does.
