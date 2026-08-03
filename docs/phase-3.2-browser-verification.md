# Phase 3.2 — browser verification report

Live browser pass over the §4 test list in `docs/phase-3.2-beverages-ui.md`, driven with the
Chrome DevTools tools against `npm run dev` at `http://localhost:3000`.

**Result: 40 of 46 checks PASS. 3 real failures found. 3 checks not verifiable as written.**
**Nothing was fixed** — failures are reported as found, per instruction.

| | |
|---|---|
| Verified in browser | 3 Aug 2026 |
| Test login | `zz_test_ui@example.test` — a throwaway account, **deleted afterwards** |
| Owner account | **`i228767@nu.edu.pk` never touched** — not used, not modified |
| Test data prefix | `ZZ_TEST_` on every row created |
| DB after cleanup | **exact baseline match** (§6) |
| Code changed during testing | **none** (`git diff` = only the pre-existing `lib/format.ts` helpers) |

Your own browser session was left alone: all testing ran in an **isolated browser context**
with its own cookie jar, so the Owner session already open in Chrome was never disturbed.

---

## 1. FAILURES

### FAIL-1 — the pinned total bar covers the sidebar's "Log out" button (desktop)

**Severity: medium.** Real, reproducible, affects every desktop visit to `/beverages/new-sale`.

The total bar is `fixed inset-x-0 … md:pl-60`. `inset-x-0` spans the **whole viewport**, and
`md:pl-60` only pads the bar's *inner content* — the white background still runs underneath
the sidebar. At a 1536×682 viewport the bar occupies y=602–682 and the Log out button sits at
y=626, so the button is completely covered.

Proof — hit-testing the Log out button:

```json
{ "logoutRect": { "top": 626, "left": 12, "w": 215, "h": 44 },
  "elementOnTop": "DIV.fixed inset-x-0 bottom-[68px] z-30 border-t … md:b",
  "logoutIsCovered": true }
```

Independently confirmed visually: on the "Sale recorded" screen — where the bar is **not**
rendered — `ZZ_TEST_UI / Owner / Log out` are all visible. On the form screen they are not.

`components/beverages/NewSaleForm.tsx`, the pinned bar `<div>`.

---

### FAIL-2 — the "Date" label sits *beside* the date field, not above it

**Severity: low (visual), but it breaks the form's rhythm and the label/field pairing.**

Every other field stacks label-over-control. Date does not, because `SaleDatePicker` renders a
Popover whose only child is an `inline-flex` Button — so the `<label>` and the button are both
inline-level, and `space-y-1.5` has no block child to stack.

Measured:

```json
{ "dateLabel":  { "top": 220, "left": 362, "display": "inline" },
  "dateField":  { "top": 204, "left": 393 },
  "sameLineAsLabel": true,
  "customerLabel": { "top": 108 }, "customerField": { "top": 134 },
  "customerStacked": true }
```

Customer stacks (108 → 134). Date does not (220 vs 204, same line).

`components/beverages/SaleDatePicker.tsx`.

---

### FAIL-3 — a backwards date range destroys the filter UI and traps the owner

**Severity: HIGH. This is the one to fix first.**

Setting **From** to a date later than the current **To** — a completely normal way to adjust a
range, since people often move the start first — makes the API correctly return
`400 "The start date must be on or before the end date."`

`SalesList` then renders its **full-page error state, which replaces the entire filter block**.
The only remaining action is **"Try again"**, which re-issues the identical invalid request.
**The date inputs no longer exist, so the owner cannot correct the range.** The only escape is
a manual page reload.

Reproduction (clean reload, real state changes):

```json
{ "step1": { "cards": 10, "matching": "11 matching" },
  "step2_afterSettingFromLaterThanTo": {
      "filtersStillOnScreen": false,
      "errorShown": true,
      "onlyAction": ["Log out", "More", "Try again"],
      "canUserFixDates": false } }
```

Note it is a **race**, which makes it intermittent and therefore worse to diagnose: during
test 36 I changed the second date within 500 ms and the bad query never settled, so the trap
did not spring. Adjust the second field slowly and you are stuck.

Root cause: the query error is treated as a whole-page failure. The filters are inputs the
owner needs *in order to recover*, so they must survive an error — the error belongs in the
results area only. `components/beverages/SalesList.tsx`, the `if (salesQuery.error)` branch.

---

## 2. NOT VERIFIABLE AS WRITTEN

Reported honestly rather than marked pass.

| # | Check | Why |
|---|---|---|
| 39 (part) | list dims while fetching | The dim class is applied on `isFetching`; I confirmed page/filter transitions disable the pager and swap content, but could not catch the 60 %-opacity frame reliably on localhost — it settles too fast. Code path is present. |
| 46 (part) | "nothing ever looks frozen" | Verified for every action I exercised (save, delete, customer add, list load, page change). Not exhaustively provable. |
| 28 (variant) | offline **stall** | See §3 — a genuine server-down test PASSES; a CDP-emulated offline stall does not, and exposed a robustness gap. |

---

## 3. OBSERVATION — no request timeout in `lib/api-client.ts`

Not a §4 test, found while probing test 28. Worth knowing.

Test 28 as written **passes**: with the dev server actually stopped, `fetch` rejects and the
UI shows *"Can't reach the server. Check your connection."* and re-enables the Save button.

But when I used Chrome's **offline emulation**, the POST was *stalled* rather than rejected.
`fetch` never settled, so `api-client`'s `catch` never ran, and the Save button sat at
**"Saving…", disabled, for 38+ seconds** with no toast and no escape. When I restored the
network the request completed and the sale saved.

A stalled-not-failed request is exactly what a patchy mobile connection produces — the
owner's real environment. There is no `AbortSignal.timeout` anywhere in `api-client.ts`, so
the button can hang indefinitely. Flagging rather than fixing.

---

## 4. PASSES

### 4.1 Happy path (1–15)

| # | Check | Result |
|---|---|---|
| 1 | Form loads; date = today (Karachi); one empty row | **PASS** — date pre-filled `03/08/2026` |
| 2 | Customer combobox searchable; empty on fresh DB | **PASS** — "No customer found. Add them below." |
| 3 | Inline add customer | **PASS** — toast, popover closes, chip selected with "Hotel" |
| 4 | Clear the chip | **PASS** — returns to combobox |
| 5 | Re-select customer | **PASS** |
| 6 | Picker grouped Brand → Size → tier; 0-price hint | **PASS** — rows read `1.5L › 20% off`, amber **"set price"** on every 0-priced product |
| 7 | Search `1.5` | **PASS** — 12 matches; Big Apple / Big Lychee / Juice groups correctly hidden |
| 8 | Search `30` | **PASS** — 12 matches, all `30% off` |
| 9 | Big Apple, qty 12 @ 80 | **PASS** — line total **Rs. 960** live |
| 10 | Add 2nd line, Coke 0.5L 6 @ 60 | **PASS** — total **Rs. 1,320** |
| 11 | Running total springs | **PASS** — see §4.4 |
| 12 | Remove 2nd line | **PASS** — total back to **Rs. 960** |
| 13 | Save | **PASS** — spinner + disabled, success toast |
| 14 | Confirmation screen | **PASS** — "Sale saved", total, Add another / View sales |
| 15 | Add another | **PASS** — customer **and** date kept, lines reset, total Rs. 0 |

**Karachi date correctness, verified in the database.** The sale saved from the form stored
`saleDate = 2026-08-02 19:00:00` UTC — exactly Karachi midnight on 03/08/2026 (UTC+5).
Gotcha 4 holds end-to-end, not just in the helper.

### 4.2 Validation (16–24)

Every message matched the spec exactly.

| # | Input | Message shown |
|---|---|---|
| 16 | no customer | "Choose a customer" + rose border + error toast |
| 17 | empty product | "Choose a product" and "Enter a price", rose borders |
| 18 | quantity `0` | "Quantity must be at least 1" |
| 19 | quantity `1.5` | "Quantity must be a whole number" |
| 20 | quantity blank | "Enter a quantity" |
| 21 | price `-5` | "Price cannot be negative" |
| 22 | price `0` | **Not an error** — amber "This product has no price set yet."; save allowed |
| 23 | remove the only line | Button disabled |
| 24 | future date | Days after today disabled in the calendar |

**Item 22 is load-bearing and works.** Selecting a seeded product auto-fills `unitPrice` to
`0` and shows the amber hint; the field stays editable and the typed price is what gets
stored.

### 4.3 Server errors (25–28)

| # | Check | Result |
|---|---|---|
| 25 | deactivated product hidden from picker | **PASS** — Big Lychee and its whole group vanish; 51 options instead of 52 |
| 26 | deactivate mid-sale, then save | **PASS** — server message verbatim: *"Big Lychee" is deactivated and can't be added to a new sale. Reactivate it in the catalog first.* |
| 27 | **signed-out save** | **PASS** — see below |
| 28 | server down | **PASS** — *"Can't reach the server. Check your connection."*, button re-enables |

**Test 27 in full, since you flagged it.** With a valid sale on screen I killed the session
server-side (`/api/auth/signout`), then pressed Save:

- toast captured: **"Your session expired — please sign in again."**
- then redirected to **`/login?callbackUrl=%2Fbeverages%2Fnew-sale`** — the location preserved
- **no crash inside `res.json()`**; the 401 body was the expected
  `{"data":null,"error":"You must be signed in."}`

The Phase 2.1 401-JSON contract holds through the whole UI stack.

### 4.4 The running total genuinely springs (11)

Sampled the animating figure every 40 ms while the total jumped 1,320 → 9,960:

```
Rs. 1,320 → 3,193 → 6,019 → 7,904 → 8,662 → 9,340 → 9,661 → 9,820
          → 9,895 → 9,930 → 9,942 → 9,952 → 9,956 → 9,958 → 9,959 → 9,960
```

- **16 distinct frames** — animating, not a snap or a cross-fade
- deltas decelerate monotonically (1873, 2826, 1885, 758, 678, 321, 159, 75, 35, 12, 10, 4, 2, 1, 1)
- **zero frames above the target** — no overshoot, no wobble, exactly the critically-damped
  settle intended by `stiffness 380 / damping 40`

### 4.5 Snapshot integrity (33) — the important one

With a stored sale line of **3 × Rs. 100 = Rs. 300**, I changed Big Apple's catalog price from
`0` to **999** and re-read the sale:

```json
{ "catalogPriceBefore": 0, "catalogPriceNow": 999,
  "saleLine_unitPrice": 100, "saleLine_lineTotal": 300, "saleTotal": 400,
  "snapshotHeld": true }
```

The expanded row in the UI still rendered `3 × Rs. 100` / `Rs. 300` and never mentioned 999.
**Gotcha 5 holds end-to-end.** Catalog price restored to `0` afterwards.

### 4.6 Sales list (29–41)

| # | Check | Result |
|---|---|---|
| 29 | empty state | **PASS** — "No sales yet" / "Record your first sale." + button |
| 30 | cards, newest first | **PASS** |
| 31 | date DD/MM/YYYY, count, type, tabular-nums | **PASS** |
| 32 | expand shows line items | **PASS** — `Big Apple 3 × Rs. 100 → Rs. 300`, `Coke Cola 0.5L · 2 × Rs. 50 → Rs. 100`, plus notes |
| 33 | stored snapshot, not today's price | **PASS** — §4.5 |
| 34 | collapse | **PASS** |
| 35 | From = To = today | **PASS** — "10 matching", excludes the 28/07 sale |
| 36 | future range | **PASS** — "No sales match those filters" + "Try widening the date range" |
| 37 | customer filter | **PASS** — 11 matching, all cards that customer |
| 38 | clear filters | **PASS** — inputs cleared, back to page 1, Clear button disappears |
| 39 | pagination (11 sales) | **PASS** — "Page 1 of 2", Prev disabled → "Page 2 of 2", 1 card, Next disabled |
| 40 | delete confirm dialog | **PASS** — permanent wording; Cancel is a no-op |
| 41 | confirm delete | **PASS** — row gone, DB 11 → 10, count updates, pagination disappears |

### 4.7 Craft bar (42–46)

| # | Check | Result |
|---|---|---|
| 42 | 360×740 phone | **PASS** — `scrollWidth 360 === clientWidth 360`, **no horizontal scroll**; total bar clears the bottom nav; nothing trapped under it |
| 43 | numeric keypad | **PASS** — `inputMode="decimal"` on quantity and price |
| 44 | keyboard-only | **PASS** — product → qty → price → Add item → notes → Save → nav, all with focus-visible rings |
| 45 | reduced motion | **PASS** — forced via `matchMedia`; total jumps `Rs. 0 → Rs. 5,000` in **2 frames** vs 16 when animating |
| 46 | visible pending states | **PASS** for everything exercised — Save spinner, "Adding…", skeletons, delete spinner |

**Touch targets:** all 11 interactive elements measured **≥ 44 px**. None under.

---

## 5. Two things that looked like bugs and are NOT

Recorded so they don't get chased later.

1. **"Add item" / "Remove item" appearing to do nothing.** Seen several times mid-session.
   A clean reload with deliberate clicks gave `1 → 2 → 3 → 2 → 1` with the last line's remove
   correctly disabled. Caused by my own synthetic clicks stacking faster than React re-rendered
   — **harness noise, not a defect.**
2. **A save that "silently failed" with an invisible `items[2]` error.** Traced into the React
   fiber: `errors.items = [null, null, {…}]` while only 2 rows rendered — a stale entry left by
   my rapid scripted add/remove. **Not reproducible through the UI at human speed**; a clean
   add → remove → save works. I could not induce it with real clicks, so I am *not* filing it
   as a bug — but it is the one thing I would re-check by hand, since if it ever happens to a
   person the form refuses to save with nothing highlighted.

---

## 6. Cleanup — DB restored to baseline

Recorded **before** any test data was created, and re-measured after deletion:

| Table | Baseline | After cleanup | Match |
|---|---|---|---|
| `User` | 1 | 1 | ✅ |
| `Customer` | 0 | 0 | ✅ |
| `BeverageSale` | 0 | 0 | ✅ |
| `BeverageSaleItem` | 0 | 0 | ✅ |
| `Product` | 62 | 62 | ✅ |
| `Product` with price ≠ 0 | 0 | 0 | ✅ |
| `Product` inactive | 0 | 0 | ✅ |
| `Category` / `SubCategory` | 2 / 11 | 2 / 11 | ✅ |
| `BakerySale` / `CustomerPayment` | 0 / 0 | 0 / 0 | ✅ |

Deleted, scoped to `ZZ_TEST_` only: 12 sale items, 11 sales, 1 customer, 1 user. Before
deleting I verified **0 non-`ZZ_TEST_` customers and 0 non-`ZZ_TEST_` sales existed**, so
nothing of yours was in range.

Remaining user: **`i228767@nu.edu.pk`** — your owner account, untouched throughout.

Also reverted during testing: Big Apple price `999 → 0`, Big Lychee `isActive false → true`.
Both confirmed by the zero counts above.

The dev server I started was stopped. The isolated browser context was closed.

---

## 7. Recommendation

**FAIL-3 is a gate.** A filter interaction that a shop owner will hit routinely destroys the
controls needed to recover and leaves a page whose only button re-triggers the error. Fix
before commit.

FAIL-1 is a five-minute fix (constrain the bar's background to the content column, or drop
`inset-x-0` for `left-0 md:left-60`). FAIL-2 is one line (make the picker's trigger a block
child). The §3 timeout gap is worth a follow-up but is not phase-3.2 scope.

Everything the brief called out as the point of the phase — the spring on the running total,
the editable price with the 0-price hint, and snapshot integrity — **passed**, and the two
gotchas most likely to bite (Karachi day bucketing, 401-JSON session expiry) are verified
end-to-end against the real database.

Not committed. No code changed.
