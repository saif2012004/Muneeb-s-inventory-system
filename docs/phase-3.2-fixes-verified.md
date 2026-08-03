# Phase 3.2 — fixes applied and re-verified in the browser

Follow-up to `docs/phase-3.2-browser-verification.md`. All four requested items fixed and
**re-verified live in Chrome**, not on a build alone.

**Result: 4 of 4 fixed and verified. One of them needed a second fix the brief did not
anticipate — see §4.**

| | |
|---|---|
| Re-verified | 4 Aug 2026, `npm run dev` + Chrome DevTools |
| Test login | `zz_test_ui@example.test` — throwaway, **deleted afterwards** |
| Owner account | **`i228767@nu.edu.pk` never touched** |
| Test data | all `ZZ_TEST_`-prefixed, **deleted**; DB back to exact baseline (§6) |
| `tsc --noEmit` / `next lint` | clean |

---

## 1. FAIL-3 (gate) — a backwards date range no longer destroys the filters

**Two changes, defence in depth.**

1. **Client-side guard.** `invalidRange = dateFrom && dateTo && dateFrom > dateTo` (both are
   `yyyy-MM-dd`, so a string compare *is* the chronological compare). The query is passed
   `enabled: !invalidRange`, so **the invalid request is never sent**. `useBeverageSales` now
   takes an optional `{ enabled }`.
2. **A query error is now a RESULTS-area error, not a whole-page one.** The `if
   (salesQuery.error) return …` early-return is gone; the error renders in the list slot,
   below the filters, which stay on screen.

Also added: an inline hint with a **"swap them"** one-click fix, `aria-invalid` +
`aria-describedby` on both date inputs, rose borders, and the count line reads *"Showing the
last valid results"* while the range is crossed. I **removed** `max={dateTo}` from the From
input — clamping it prevented moving the start forward first, which is the very gesture that
triggered the bug.

### Re-verified — the exact failing scenario, slowly

```json
{ "step1_validTo":        { "cards": 2, "matching": "2 matching" },
  "step2_backwardsRange": { "filtersSurvived": true,
                            "fromValue": "2026-08-20", "toValue": "2026-08-04",
                            "inlineHint": "The start date is after the end date. Adjust either date — or swap them.",
                            "fromMarkedInvalid": "true",
                            "wholePageError": false,
                            "resultsStillShown": 2,
                            "clearFiltersPresent": true,
                            "swapPresent": true } }
```

### Both recovery paths work, with no reload

```json
{ "recoveryA_swap":     { "from": "2026-08-04", "to": "2026-08-20", "hintGone": true, "matching": "1 matching" },
  "brokenAgain":        { "hint": true, "filtersPresent": true },
  "recoveryB_editDate": { "from": "2026-07-01", "to": "2026-08-20", "hintGone": true,
                          "matching": "2 matching", "neededReload": false } }
```

### And the invalid request never reaches the server

Full network log across that whole sequence — only valid ranges, **zero 400s**:

```
GET /api/beverages/sales?page=1&limit=10
GET /api/beverages/sales?dateTo=2026-08-04&page=1&limit=10
GET /api/beverages/sales?dateFrom=2026-08-04&dateTo=2026-08-20&page=1&limit=10
GET /api/beverages/sales?dateFrom=2026-07-01&dateTo=2026-08-20&page=1&limit=10
```

Re-confirmed once more after the §4 change: filters survived, hint shown, no whole-page
error, 5 results still on screen.

**PASS.**

---

## 2. FAIL-1 — the total bar no longer covers the sidebar

`fixed inset-x-0 … md:pl-60` → **`fixed left-0 right-0 … md:left-60`**. The background panel
itself now stops at the sidebar edge, rather than spanning the viewport with only its inner
content padded.

```json
{ "viewport": { "w": 1440, "h": 800 },
  "logoutRect": { "top": 744, "left": 12, "w": 215 },
  "elementOnTop": "BUTTON.inline-flex items-center whitespace-nowrap transition-colors",
  "logoutIsCovered": false,
  "barRect": { "left": 240, "right": 1425, "top": 721 },
  "barStartsAfterSidebar": true }
```

`elementOnTop` is now the Log out button itself, and the bar starts at exactly x=240 — the
sidebar width (`md:left-60` = 15rem). Confirmed visually too.

**PASS.**

---

## 3. FAIL-2 — the Date label sits above its field

`SaleDatePicker` now wraps the Popover in a `<div className="block">`, giving `space-y-1.5` a
block-level child to stack. (A Popover renders only its trigger, and the trigger is an
`inline-flex` Button — two inline siblings cannot be stacked by vertical spacing utilities.)

```json
{ "dateLabel":  { "top": 202, "left": 314 },
  "dateField":  { "top": 228, "left": 314 }, "dateStacked": true,
  "customerLabel": { "top": 108, "left": 314 },
  "customerField": { "top": 134, "left": 314 }, "customerStacked": true,
  "labelsAlign": true }
```

Date now behaves exactly like Customer — label above, same left edge. Confirmed visually.

**PASS.**

---

## 4. §3 timeout — fixed, but it needed a second change

### 4.1 What was asked, and why it was not sufficient on its own

Added to `lib/api-client.ts`:

```ts
const REQUEST_TIMEOUT_MS = 15_000;
signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
```

Verified present in the served client bundle:

```
_init_signal !== void 0 ? _init_signal : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
```

And verified **firing on a real stall**: a cold Next dev route compile exceeded 15 s, the
request was aborted, and the page showed *"Couldn't load the form / Can't reach the server.
Check your connection."* with a working **Try again**. That is exactly the intended behaviour.

**But the offline re-test still hung**, which is what you asked me to check:

```json
{ "navigatorOnline": false, "whilePending": { "text": "Saving…", "disabled": true },
  "recoveredAtMs": null, "hungForever": true, "toasts": [] }
```

### 4.2 Root cause — the fetch was never issued

Investigated rather than assumed:

- A manual `fetch(..., { signal: AbortSignal.timeout(4000) })` while offline rejected in
  **54 ms** — so `fetch` + abort work correctly.
- Yet the network panel showed **no POST at all** for the app's save.
- The mutation resumed and succeeded the instant connectivity returned.

That is **TanStack Query's default `networkMode: "online"`**: while `navigator.onLine` is
false it *pauses* queries and mutations — `mutationFn` is never called. There is no fetch for
`AbortSignal.timeout` to abort, so the timeout could not possibly have helped. The button sat
at "Saving…", disabled, with no request, no error and no toast.

### 4.3 The second fix

`components/providers/query-provider.tsx` — `networkMode: "always"` on both queries and
mutations, so the request actually runs, fails fast, and lands in api-client's existing catch.

**This is one change beyond your literal instruction.** I made it because without it the
acceptance criterion you set — *"the Save button must recover, not hang indefinitely"* —
still failed, and reporting the timeout as "fixed" would have been untrue.

### 4.4 Re-verified offline

```json
{ "navigatorOnline": false,
  "whilePending": { "text": "Save sale", "disabled": false },
  "recoveredAtMs": 305,
  "hungForever": false,
  "finalButton": { "text": "Save sale", "disabled": false },
  "toasts": ["Can't reach the server. Check your connection."] }
```

Recovers in **305 ms** with the friendly message and a usable button — versus hanging forever.

**Regression check:** back online, the same sale saved normally — *"Sale recorded for
ZZ_TEST_Fix Verify Hotel"*, confirmation panel shown. No phantom or duplicate sale.

**PASS.** The two mechanisms are complementary: `networkMode: "always"` covers *no
connection*, the 15 s timeout covers *connection up but stalled*.

---

## 5. Files changed

| File | Change |
|---|---|
| `components/beverages/SalesList.tsx` | Client-side range guard; query error moved into the results area; inline hint + swap-them; `aria-invalid`; removed the `max` clamp |
| `lib/hooks/use-beverage-sales.ts` | `useBeverageSales` accepts `{ enabled }` |
| `components/beverages/NewSaleForm.tsx` | Bar `left-0 md:left-60` instead of `inset-x-0` |
| `components/beverages/SaleDatePicker.tsx` | Block wrapper around the Popover |
| `lib/api-client.ts` | `AbortSignal.timeout(15_000)` on every request |
| `components/providers/query-provider.tsx` | `networkMode: "always"` on queries and mutations |

---

## 6. Cleanup — DB restored to baseline

| Table | Baseline | After | Match |
|---|---|---|---|
| `User` | 1 | 1 (`i228767@nu.edu.pk`) | ✅ |
| `Customer` | 0 | 0 | ✅ |
| `BeverageSale` | 0 | 0 | ✅ |
| `BeverageSaleItem` | 0 | 0 | ✅ |
| `Product` (total / priced / inactive) | 62 / 0 / 0 | 62 / 0 / 0 | ✅ |
| `Category` / `SubCategory` | 2 / 11 | 2 / 11 | ✅ |
| `BakerySale` / `CustomerPayment` | 0 / 0 | 0 / 0 | ✅ |

Deleted, `ZZ_TEST_`-scoped only: 5 sale items, 5 sales, 1 customer, 1 throwaway user. Verified
**0 non-`ZZ_TEST_` customers and 0 non-`ZZ_TEST_` sales** existed before deleting. Testing ran
in an isolated browser context; dev server stopped afterwards.

---

## 7. Note for later (not fixed, not in scope)

The dev-mode cold compile exceeding 15 s means a **first** navigation to an uncompiled route
can show "Can't reach the server" in `next dev`. Production has no on-demand compile, so this
does not affect the deployed app — but expect it occasionally while developing. If it becomes
annoying, the timeout could be raised in development only.

Also still open from the original report: the sales-list date filters use native
`<input type="date">`, which renders in the **browser's** locale (mm/dd/yyyy on this machine)
rather than the DD/MM/YYYY the Design System specifies. Cosmetic, unchanged, worth a decision
in Phase 8.
