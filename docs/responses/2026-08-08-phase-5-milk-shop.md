# Phase 5 — the milk shop

Date: 2026-08-08
Session: `muneeb inventory dev4`
Kickoff confirmation: `docs/responses/2026-08-07-phase-5-kickoff-confirmation.md`

**Status: built, type-checked, linted, verified in a real browser end-to-end, and verified at
a confirmed 360px mobile viewport.** One real bug was found in the browser and fixed. All
test data removed; DB back to exact baseline (twice — once after the desktop pass, once
after the mobile pass).

**No migration was required** — `Farmer`, `MilkDelivery`, `FarmerPurchase` and `MilkSale`
already existed and were already RLS-enabled. **No existing file was modified.** Everything
below is new; `git status` shows additions only.

---

## 1. What shipped

### Server

| File | What it is |
|---|---|
| `lib/validations/milk.ts` | zod schemas — farmers, deliveries, quick entry, purchases, milk sales |
| `lib/milk.ts` | **THE farmer net-balance calculation** + delivery/sale total helpers + row selects |
| `lib/milk-display.ts` | Client-safe presentation (tone, labels, `formatSessionLiters`) |

### Routes (all `runtime = "nodejs"`, all `requireOwner()` first, all `{ data, error }`)

| Method | Route |
|---|---|
| GET, POST | `/api/milk/farmers` |
| GET, PATCH, DELETE | `/api/milk/farmers/[id]` |
| GET, POST | `/api/milk/farmers/[id]/deliveries` |
| PATCH, DELETE | `/api/milk/farmers/[id]/deliveries/[deliveryId]` |
| GET, POST | `/api/milk/farmers/[id]/purchases` |
| PATCH, DELETE | `/api/milk/farmers/[id]/purchases/[purchaseId]` |
| GET, POST | `/api/milk/deliveries/quick-entry` |
| GET, POST | `/api/milk/sales` |
| GET, PATCH, DELETE | `/api/milk/sales/[id]` |

### Client

`lib/hooks/use-milk.ts`, `components/milk/{MilkHub,QuickEntryGrid,FarmerProfile,FarmerDialog,
DeliveryDialog,PurchaseDialog,MilkSalesList,MilkSaleDialog}.tsx`,
`components/shared/ConfirmDialog.tsx`, and pages at `/milk`, `/milk/quick-entry`,
`/milk/farmers/[id]`, `/milk/sales`.

---

## 2. The decisions that matter

### Milk is NOT a third sale module

The prompt warned about this and it held up. `MODULE_CATEGORIES` has only `beverages` and
`bakery`; a `MilkSale` has **no line items and no product FK** — it is one row of
`liters × ratePerLiter`. So there is no catalog price to snapshot and `reconcileSaleLines()`
has nothing to reconcile. Adding a third `SaleModule` row and reusing
`components/sales/NewSaleForm` would have meant bending a basket-builder around something
that has no basket. What *was* reused: `requireOwner`, the `{data,error}` envelope,
`serialize`, `buildSaleDateWindow`/`isSaleProblem`/`checkTotalFits` from `lib/sales.ts`,
`CustomerCombobox`, `SaleDatePicker`, and the Design System.

### The sign is inverted versus customers — the module's sharpest trap

| | Positive means | Colour |
|---|---|---|
| Customer `outstanding` | they owe the owner | rose |
| Farmer `netBalanceOwed` | **the owner owes them** | emerald |

Both are positive numbers about money pointing in opposite directions. Reusing the customer
helpers would paint every unpaid farmer as if the farmer were in debt — backwards, in the
direction that makes the owner think a bill is settled when it isn't. `lib/milk-display.ts`
is the only place the mapping is decided.

### Debts and advances are never netted

`summariseFarmerBalances()` reports `totalOwedToFarmers` and `totalAdvanced` separately.
Summing signed balances would report "nothing to pay" for one farmer owed 5,000 and another
5,000 ahead — while the first still needs 5,000 in cash.

### null litres ≠ 0 litres

`morningLiters`/`eveningLiters` are null when the session did not happen, which is different
from arriving with nothing. `serializeLiters()` already existed for exactly this;
`formatSessionLiters()` renders null as "—". Verified in the browser: a farmer with no
morning shows an empty box, never "0".

### One delivery per farmer per Karachi day — enforced in the route, not the DB

There is no unique constraint on `(farmerId, deliveryDate)` and adding one would need a
migration. The POST route refuses a duplicate with 409 + `existingDeliveryId`; quick entry
looks up the day's row and UPDATES it. That is what makes the evening pass land on the
morning's row instead of creating a second one. Matched over the whole Karachi day rather
than by timestamp equality, since a full ISO string passes through with its time intact.

### Quick entry never deletes

A blank row is the normal state for a farmer who didn't come, so blanks are skipped. But
blanking a row that *already has* a delivery is ambiguous, and silently ignoring it would be
the worst outcome — success toast, entry still there. Those come back in `clearedButKept` and
the UI warns explicitly. Deletion stays an explicit action with a confirm dialog, per the
Design System.

### Pool discipline

No `Promise.all` anywhere. The farmer profile is three sequential queries and derives the
balance, both tables and the ledger from ONE fetch of the rows. Quick entry does all reads
**before** opening its transaction — with `connection_limit=1` a query issued on `prisma`
while a transaction is open would wait for the connection the transaction is holding and
deadlock until the pool timeout. The transaction gets `timeout: 25s` because the default 5s
would abort a full round of farmers mid-save.

### One Context7 check that changed the code

Prisma 6 deduplicates `distinct` **in memory** by default. "Each farmer's last rate" via
`distinct: ["farmerId"]` would therefore have fetched every delivery row the farmer had ever
had. Replaced with a bounded 60-day lookup.

---

## 3. Browser verification

Driven against `npm run dev` at `http://localhost:3000`.

| | |
|---|---|
| Test login | `zz_test_milk@example.test` — throwaway, **deleted afterwards** |
| Owner account | **never touched** |
| Test data prefix | `ZZ_TEST_` on every row |
| DB after cleanup | **exact baseline match** (§5) |

| # | Check | Result |
|---|---|---|
| 1 | `/milk` signed out → redirected to `/login` | PASS |
| 2 | Hub renders: emerald accent, 3 tiles, empty state, sidebar active | PASS |
| 3 | Add farmer → toast, list updates, count 1, "Settled" | PASS |
| 4 | Quick entry defaults to Karachi today (08/08/2026) | PASS |
| 5 | "Apply to all" fills every rate | PASS |
| 6 | Live math: 12.5×210 = 2,625; 8×210 = 1,680; total 20.5 L / Rs. 4,305 | PASS |
| 7 | Save day → "Saved — 2 added"; rows flip to "Already recorded for this date" | PASS |
| 8 | **Evening pass on the same row** → "Saved — **2 updated**", Ali 22.5 L | PASS |
| 9 | Farmer profile: You owe Rs. 4,725; milk 4,725; purchases 0; 22.5 L | PASS |
| 10 | Delivery row shows "Morning 12.5 L · Evening 10 L", 22.5 L × Rs. 210 | PASS |
| 11 | Record purchase Rs. 1,200 → balance drops to Rs. 3,525 | PASS |
| 12 | Ledger: running balance 4,725 → 3,525; purchase rose/negative, milk emerald | PASS |
| 13 | Milk sale 20 L × 230 → Rs. 4,600 on `/milk/sales`, totals 20 L / 1 sale | PASS |
| 14 | **Milk sale reaches receivables** — `/customers` shows Rs. 4,600 outstanding | PASS |
| 15 | Customer profile shows the milk purchase with emerald dot, "20 L × 230" | PASS |
| 16 | Blanked row → amber warning naming the farmer, delivery NOT deleted | PASS |
| 17 | Cleared box reseeds to the stored value after save | **FAIL → fixed → PASS** |
| 18 | No console errors across the session | PASS |
| 19 | Sticky save bar clears the sidebar's Log out button | PASS |
| 20 | 360px mobile layout | **PASS** — measured, see §4 |

Check 14 is the first time the Phase 4b claim has actually run with real `MilkSale` rows —
`lib/receivables.ts` needed no change, exactly as predicted.

### The bug (check 17)

Blanking a farmer's litres and saving left the box empty while the delivery still existed —
the grid displayed "no delivery" next to a delivery that was still on the books. A reload
showed the correct value, so the data was always right; the **display was lying**.

Cause: TanStack Query's structural sharing. Quick entry never deletes, so that save changed
nothing server-side, the refetch returned deeply-equal data, and Query kept the **same array
reference**. My reseed effect was keyed on `[serverRows]`, so it never re-ran.

Fix: a `seedVersion` counter bumped in the mutation's `onSuccess` and added to the effect
deps, forcing a reseed from the server after every save. Deliberately *not* keyed on
`dataUpdatedAt`, which also fires on window-focus refetches and would wipe half-typed litres
mid-round. Re-tested: the box now snaps back to 8, the warning still fires, and the totals
bar agrees with what is stored.

This is exactly the failure mode CLAUDE.md warns about — `tsc` and `next lint` were clean
both before and after. It is now recorded as a general guardrail in the client data-fetching
section, because any "seed local form state from server data" effect can hit it.

### One near-miss caught before testing

My sticky save bar was originally `md:left-64`, but the sidebar is `w-60`. That is the same
class of bug as Phase 3.2's FAIL-1, where a full-width bar's background ran under the sidebar
and covered the Log out button. Corrected to `md:left-60` (constraining the left EDGE, not
padding the contents) and confirmed in the browser.

---

## 4. Mobile verification at 360px — PASS

The first attempt was reported as unverified because `resize_window` returned success while
the viewport stayed at 502px (Windows 125% display scaling). Re-done properly with CDP
device-metrics override (`Emulation.setDeviceMetricsOverride` via the DevTools MCP), and the
viewport was **confirmed before measuring, not assumed**:

```json
{ "innerWidth": 360, "innerHeight": 740, "devicePixelRatio": 3, "isMobile": true, "hasTouch": true }
```

**Measured viewport width: 360px** on every check below.

| Check | Quick entry | Farmer profile | Milk hub |
|---|---|---|---|
| `scrollWidth === clientWidth === 360` | PASS | PASS | PASS |
| Elements overflowing the viewport | **0** | **0** | **0** |
| Controls under 44px (tabs excluded) | **0** | **0** | **0** |

**Quick entry — the screen that matters, since the owner uses it twice a day on a phone:**

- **Input grid usable, not cramped.** Morning / Evening / Rate each **93 × 44px**, laid out
  at x = 33–126, 134–226, 234–327 — three columns inside 360px with real gaps and no overlap.
- **Numeric keypad on every field.** All 10 inputs report `inputmode="decimal"`, including
  the "Rate for everyone" control (112 × 44).
- **Sticky save bar sits above the bottom nav and covers nothing.** Save bar occupies
  y = 602–672; bottom nav y = 683–740 — an 11px gap, no overlap. Scrolled to the very bottom
  (scrollY 380 = max), the last farmer's card ends at y = 532, clear of the bar at 602, so
  `pb-28` gives real clearance rather than hiding the final row.
- **Touch targets:** Save day 141 × 44, Apply to all 108 × 44, date picker 148 × 44.
- **Worst-case content holds.** Stress-tested with the longest name plus a 5-figure total —
  `ZZ_TEST_Chaudhry Muhammad Ismail`, 225.25 L × 210 = **Rs. 47,303**. The name truncates
  with an ellipsis, the amount and litres stay right-aligned, and overflow count stayed **0**.

**Farmer profile:** the only sub-44px controls are the three `TabsTrigger`s at **28px** — the
known Phase 8 app-wide item, deliberately excluded and deliberately not patched here. The
"All farmers" back link measures ≥44px (the Phase 4b 20px inline-link problem does not
recur on this screen).

### Not verified / not re-tested

- **Real hardware.** This is CDP emulation at 360×740 dpr 3 with touch — geometry, not a
  physical device. Soft-keyboard behaviour over the sticky bar is the one thing emulation
  cannot honestly answer.
- The catalog delete-guard 409, still outstanding from Phase 3.

### Two environment notes (neither is a Phase 5 defect)

- **Two dev servers can corrupt `.next`.** A hard-killed server left port 3000 held while a
  second instance started on 3001 and rewrote the shared `.next`; the first then served
  404s for every client chunk. Fixed by killing both, deleting `.next`, and starting one.
- **With client JS absent, the login form falls back to a native GET** that puts the email
  and password in the query string (`/login?email=…&password=…`). This appeared only while
  the chunks above were 404ing, and did not recur once they served 200. It is Phase 1 code,
  outside this phase's scope, and I have not changed it — but it is worth a deliberate look
  later, since a password in a URL reaches history and access logs.

---

## 5. Cleanup

```
deleted: deliveries 2, farmerPurchases 1, milkSales 1, customerPayments 0,
         farmers 2, customers 1, testUsers 1

REMAINING: farmer 0, milkDelivery 0, farmerPurchase 0, milkSale 0,
           customer 0, customerPayment 0, beverageSale 0, bakerySale 0,
           product 62, category 2, subCategory 11, user 1
```

Exact baseline. The one remaining `user` is the real owner account, untouched. The temporary
cleanup script was deleted after running; `git status` shows only Phase 5 additions.

---

## 6. Known gaps / deliberate omissions

- **Touch targets:** `TabsTrigger` on the farmer profile is the 28px default flagged for the
  Phase 8 sweep. Per CLAUDE.md this is fixed **once, app-wide**, not patched per usage — so I
  left it. The row action buttons I wrote are all 44px.
- **Quick entry has no per-row delete.** Intentional: deletion needs a confirm dialog and
  lives on the farmer profile.
- **Retired farmers** are excluded from quick entry and blocked from new deliveries and
  purchases; reactivation is via the farmer's Edit dialog.
- **A milk sale's customer is not editable.** Moving a sale between customers rewrites two
  balances with nothing on either ledger explaining why; the API rejects it and the dialog
  doesn't offer it.
- **Concurrency:** the one-per-day rule is a route check, not a DB constraint, so two
  simultaneous saves could in principle both insert. Single-owner app; noted, not solved.

---

## 7. Suggested next step

Phase 6 (farmer net-balance ledger + all-farmers balance sheet) is now mostly assembled:
`getFarmerBalances()` already returns every farmer's balance in a fixed two queries and
`summariseFarmerBalances()` already computes the owed/advanced split. Phase 6 is largely a
presentation layer over what `lib/milk.ts` exposes — it must call those rather than
re-derive, and must not fall into one-query-per-farmer.

Deploying to a Vercel preview would also confirm the build, since local production builds OOM
on this machine. Say the word and I'll run it.
