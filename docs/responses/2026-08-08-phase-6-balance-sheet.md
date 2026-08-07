# Phase 6 — farmer net-balance ledger + all-farmers balance sheet

Date: 2026-08-08
Session: `muneeb inventory dev4`
Source prompt: `docs/prompt.txt`

**Status: built, type-checked, linted, browser-verified on desktop and at a confirmed 360px
viewport, test data removed, DB back to exact baseline.**

This was a presentation phase and it stayed one: **no new API route, no new query, no new
arithmetic.** One real finding was fixed (an undersized control I introduced). Two premises in
the brief turned out to be slightly off and are corrected below.

---

## 0. Step zero — the delete-guard open item (CONFIRMED closed, removed)

**Confirmed. The premise was correct and the item is now removed from CLAUDE.md.**

Evidence: `docs/responses/2026-08-04-delete-guard-retest.md`, dated 4 Aug 2026. It was
re-tested against **real sale history** (not a fixture) and passed at all three levels:

| Level | Behaviour | Result |
|---|---|---|
| Category | 409 + `blockedBy` | PASS |
| Sub-category | 409 + `blockedBy` | PASS |
| Product | 200 + soft delete | PASS |

The strongest detail in that report: `blockedBy` was proven to be **consumed structurally,
not parsed from the prose** — the UI renders a per-product sale count that appears nowhere in
the error sentence, so it can only have come from the structured field. DB was restored to
baseline afterwards.

Two stale mentions existed in `CLAUDE.md` and both were replaced with the closure record
(rather than deleted outright, so the guard's contract stays documented):

1. The Phase 2 note claiming *"the 409 path has never fired outside a test fixture"*.
2. The Phase 3 note claiming *"the delete-guard re-test is still outstanding"*.

You were right that a false open item hides the real ones — the genuinely open items are now
the login POST-only security fix and the Phase 8 touch-target sweep.

---

## 1. Two premises in the brief that were wrong

Reporting these rather than quietly working around them:

**a) There was no "balance sheet" link stubbed in MilkHub.** The brief said to *wire the link
that MilkHub stubbed in Phase 5*. It didn't — Phase 5's hub had one link card (Milk sales) and
no balance-sheet stub. So this was **added**, not wired: the hub now has a two-card grid,
Balance sheet + Milk sales.

**b) The farmer profile's tab is called "Ledger", not "Balance".** Minor, but it is the tab
the brief was pointing at, and it does exactly what item B describes.

---

## 2. What was built

| File | What |
|---|---|
| `components/milk/FarmerBalanceSheet.tsx` | The balance sheet (new) |
| `app/(dashboard)/milk/balances/page.tsx` | Route shell (new) |
| `components/milk/MilkHub.tsx` | Added the Balance sheet link card (modified) |

**No new API route.** `GET /api/milk/farmers` already returned every farmer *with* their
balance *and* the summary — built in Phase 5. The balance sheet consumes that response
verbatim. This file computes nothing except sorting and filtering an array already in memory.

### Reuse, as instructed

| Thing | Reused from | Re-derived? |
|---|---|---|
| Per-farmer balances | `getFarmerBalances()` in `lib/milk.ts` | No |
| Owed/advanced split | `summariseFarmerBalances()` | No |
| Sign → colour → wording | `lib/milk-display.ts` | No |
| Running-balance ledger | `buildFarmerLedger()` (already on the profile) | No |

---

## 3. Item B — the per-farmer ledger already exists. Not rebuilt.

**Confirmed working, nothing added.** The farmer profile's **Ledger** tab renders
`buildFarmerLedger()` output with a running balance per entry. Verified live on
`ZZ_TEST_C_Ahead`:

```
Milk     | Milk · 5 L × 200 | 08/08/2026 | Rs. 1,000  | Balance Rs. 1,000
Purchase | Cow food         | 08/08/2026 | Rs. -4,000 | Balance Rs. -3,000
```

Running balance is correct (+1,000 then −3,000), the purchase carries a negative sign, and the
colours come from the shared mapping.

### A date-range filter was NOT added — on purpose

The brief floated it as a possible gap. It isn't a cosmetic addition: **a running balance
filtered to a date window is wrong unless it carries an opening balance forward.** Start the
window on 1 August and the first row would begin from zero, making every balance below it
understate what is actually owed — a ledger that lies quietly. If this is wanted later it has
to compute and display an opening balance, which is a real feature, not a filter. Flagging
rather than shipping a misleading one.

### One measurement artifact worth recording

My first read of the Ledger tab returned an empty panel and looked like a bug. It wasn't —
Radix renders all three tabpanels and my selector grabbed the first (hidden) one. Re-querying
for the panel with `data-state="active"` showed the correct content. Noting it because the
naive check produces a convincing false failure.

---

## 4. The fixture (built to make a wrong implementation fail loudly)

Seven `ZZ_TEST_` farmers covering every branch:

| Farmer | Milk | Purchases | Net | Tests |
|---|---|---|---|---|
| A_BigOwed | 20,000 | 5,000 | **+15,000** | biggest payable → sorts first |
| B_SmallOwed | 2,000 | 0 | **+2,000** | ordinary owed |
| C_Ahead | 1,000 | 4,000 | **−3,000** | farmer ahead → rose, sorts last |
| D_Settled | 2,000 | 2,000 | **0** | settled *with* activity → filter hides |
| E_NoActivity | 0 | 0 | **0** | never traded → filter hides, "—" last activity |
| F_RetiredOwed | 4,000 | 0 | **+4,000** | **retired but owed → must NOT vanish** |
| G_RetiredZero | 0 | 0 | **0** | retired + settled → must be hidden |

**The point of the split:** correct answer is **21,000 owed / 3,000 ahead**, shown separately.
A wrongly-netted implementation would show **18,000**. The numbers are chosen so the two
cannot be confused.

---

## 5. Test results

### (e) It uses `getFarmerBalances` — fixed queries, measured not assumed

Instrumented the **real** singleton (`lib/prisma.ts` caches it on `globalThis` outside
production, so pre-seeding it with an event-logging client measures the actual code path
rather than a replica):

```json
"QUERY_COUNT": {
  "small": { "farmers": 2, "queries": 2 },
  "large": { "farmers": 7, "queries": 2 },
  "verdict": "FIXED at 2 queries for both 2 and 7 farmers - does NOT scale",
  "statementsForLargeRun": [
    "SELECT SUM(\"MilkDelivery\".\"totalAmount\") … ",
    "SELECT SUM(\"FarmerPurchase\".\"amount\") … "
  ]
}
```

**Two SQL statements, whether 2 farmers or 7.** Both are `SUM … GROUP BY` aggregates — no row
transfer, no per-farmer query. The route adds exactly one `findMany` for the farmer list, so
the whole screen is **3 queries flat**. PASS.

### (a) Owed / advanced split, separate and correct

Server-side, straight from `summariseFarmerBalances`:

```json
{ "totalOwedToFarmers": 21000, "totalAdvanced": 3000,
  "totalMilkValue": 29000, "totalPurchases": 11000, "totalLiters": 145, "farmerCount": 7 }
```

Rendered as two separate tiles — **Rs. 21,000** emerald (count-up on mount) and **Rs. 3,000**
rose. The netted figure 18,000 appears nowhere. PASS.

### (c) Sorted by biggest payable

Desktop table order, top to bottom:

```
A_BigOwed      15,000  You owe
F_RetiredOwed   4,000  You owe   [Retired]
B_SmallOwed     2,000  You owe
D_Settled           0  Settled
E_NoActivity        0  Settled
C_Ahead        -3,000  Ahead      (rendered "Rs. 3,000 Ahead", rose)
```

Biggest payable first, ahead-farmer last, G_RetiredZero correctly absent. PASS.

### (d) The settled filter

Toggling **Only farmers with a balance**: 6 rows → **4 rows**, dropping D_Settled and
E_NoActivity. `C_Ahead` is **retained** — a negative balance is still a balance, and hiding it
would conceal a farmer who owes the owner. PASS.

### (b) Balance sheet matches the farmer profile exactly

Cross-checked `ZZ_TEST_C_Ahead`, the hardest case because it is negative:

| | Balance sheet | Farmer profile |
|---|---|---|
| Milk | Rs. 1,000 | Rs. 1,000 |
| Purchases | Rs. 4,000 | Rs. 4,000 |
| Net | Rs. 3,000 | Rs. 3,000 |
| Word | "Ahead" | "AHEAD" |
| Colour | rose | rose |

Same numbers, same colour, same word — because it is the same helper, not a copy. PASS.

### Mobile, at a confirmed 360px viewport

`innerWidth: 360, dpr: 3, isMobile: true, hasTouch: true` — confirmed before measuring.

| Check | Result |
|---|---|
| `scrollWidth === clientWidth === 360` | PASS |
| Overflowing elements | **0** |
| Table hidden, cards shown instead | PASS (no h-scroll table) |
| Hub "Balance sheet" link | present, 328 × 68 |

---

## 6. The one finding, fixed

**The settled-filter Switch was a 36 × 20px touch target** — under the Design System's 44px
minimum. Measured at 360px, not assumed.

Unlike the 28px `TabsTrigger` (a pre-existing shadcn default, correctly queued for the Phase 8
app-wide sweep and deliberately left alone), **this control is new in this phase**, so it
should not ship undersized and be handed to Phase 8 as someone else's problem.

Fix: the row is now a single `<label>` with a `size-11` (44 × 44) span around the switch. The
switch keeps its 36 × 20 appearance; only the tap area grows. Because `<button>` is a labelable
element, `htmlFor` genuinely forwards clicks, so the text is tappable too.

Re-measured after the fix: **tap area 44 × 44**, visual unchanged, toggle still filters
correctly (verified by clicking it post-change).

---

## 7. Charts — deliberately none

The brief said to add them only if they genuinely help. They don't here. With a handful of
farmers each carrying a single number, a bar chart is **strictly less informative** than the
sorted table beside it: the table already gives exact values, the two components of each
balance, and the ordering the chart would encode. Adding one would be decoration, which the
brief explicitly said to skip.

Where a chart would earn its place is per-farmer litres over time — a trend the table cannot
show. That belongs with Phase 7's reports, against real history.

---

## 8. The hub-tile understatement — FOUND, then FIXED (not deferred)

Originally reported here as a gap to reconcile in Phase 8. On your instruction it was fixed
immediately, as a deliberate change to the Phase 5 hub, and re-verified in the browser.

**The bug.** The milk hub's "You owe farmers" tile fetched active farmers only, so a
retired-but-unpaid farmer was silently excluded from the landing screen's headline payable.
Retiring a farmer stops new milk; it does not erase a debt. On the fixture the hub read
**Rs. 17,000** against the balance sheet's **Rs. 21,000** — wrong in the direction of "you owe
less than you do", which is the direction the owner cannot catch by eye.

**The fix.** The hub now passes the **same** options to `useFarmers` as the balance sheet
(`withBalances: true, includeInactive: true`). That does more than make the numbers agree
today — both screens now resolve to **one TanStack cache entry**, so they are not two agreeing
calculations that could drift apart later, they are the same response rendered twice.

Three display consequences, all deliberate:

- The hub's farmer **list** stays active-only. It is the working list of people who deliver;
  a retired farmer does not belong in it, and remains reachable from the balance sheet.
- Because the tile can now exceed the visible list, it says so: **"across all farmers ·
  includes 1 retired"**, shown only when a retired farmer actually carries a balance.
- The **Farmers** count tile now counts `activeFarmers`, not everything fetched — it is
  labelled "active" and must stay true to that.

**Also fixed: the "7 farmers / 6 rows" context line.** It used the server's `farmerCount`,
which counts every farmer fetched, while the sheet hides retired-and-settled ones. It now
describes exactly the farmers on the sheet. The authoritative owed/advanced tiles are
untouched and still server-derived — they have to be unaffected by this, because every farmer
excluded is net-zero by definition and so contributes nothing to either bucket.

### Verified in the browser (fixture rebuilt, then removed)

| Check | Before | After |
|---|---|---|
| Hub "You owe farmers" | Rs. 17,000 | **Rs. 21,000** |
| Balance sheet total | Rs. 21,000 | Rs. 21,000 |
| The two agree | **No** | **Yes** |
| Hub subtext | "across all farmers" | "across all farmers · includes 1 retired" |
| Hub "Farmers" tile | 7 (would have counted retired) | **5 active** |
| Balance sheet context line | 7 farmers / 6 rows | **6 farmers / 6 rows** |
| Litres / milk / purchases | 145 L / 29,000 / 11,000 | unchanged — the excluded farmer had zero activity |

**No hub regressions:** search still filters (typing "Ahead" → 1 result, clearing → 5), the
retired farmer stays out of the list, Quick entry / Balance sheet / Milk sales links all
present, Add farmer intact, no horizontal scroll.

---

## 9. Cleanup

```
deleted: deliveries 5, farmerPurchases 3, farmers 7, testUsers 1
REMAINING: farmer 0, milkDelivery 0, farmerPurchase 0, milkSale 0,
           customer 0, customerPayment 0, beverageSale 0, bakerySale 0,
           product 62, category 2, subCategory 11, user 1
```

Exact baseline. The remaining `user` is the real owner account, never touched. Both temporary
scripts (fixture seed, query-count instrumentation) were deleted after running.
