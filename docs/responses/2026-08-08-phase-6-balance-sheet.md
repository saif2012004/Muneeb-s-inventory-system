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

## 8. Known gap this phase surfaced

**The milk hub's "You owe farmers" tile can understate the total.** It lists active farmers
only, so a retired-but-unpaid farmer is excluded from its summary — the balance sheet includes
them (`includeInactive`) and would show a larger, correct figure.

In the fixture the hub would have read **17,000** against the balance sheet's **21,000**.

I did **not** silently change Phase 5's verified hub to fix this. It is recorded in CLAUDE.md
as something to reconcile in Phase 8, since it is a behaviour change to a shipped screen and
your call which number that tile should show. The balance sheet is the authoritative one.

Minor, related: the context line reads "7 farmers" while 6 rows display, because the summary
covers the whole book including the hidden retired-and-settled farmer. Accurate for the
totals it sits under, but worth knowing.

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
