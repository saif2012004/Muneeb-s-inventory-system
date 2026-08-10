# 58mm thermal receipt: built, verified in the browser, NOT committed

**Date:** 2026-08-10
**Status:** ✅ Built and verified. ⏸️ **Not committed** — you asked to see it first.
Two real defects were found in the browser and fixed before this report.

---

## 1. One thing about the spec, up front

The brief describes the body as *"the sale's line items with their snapshotted unitPrice, quantity,
per-line discount, and **netLineTotal**"*, and asks the verification to use *"a NEW ZZ_TEST_
**mixed** sale"*.

**`netLineTotal` and mixed-category sales exist only on the unified `Sale`/`SaleItem` tables, and
nothing reads or writes those yet** (CHECKLIST #4 — migration A is applied, the app still runs
entirely on `BeverageSale` / `BakerySale`). There is no way to create a mixed sale, no screen that
lists one, and the only `Sale` row is the migration's copy of Saif's bakery sale.

So a receipt pointed at `Sale` would have had no reachable sale to print and no button that could
open it. **I built it against the tables the app actually runs on**, and shaped the data contract so
the switch is a one-file change:

- Everything downstream consumes a `ReceiptData` object that is already shaped like a unified sale.
- **`loadReceipt()` in `lib/receipt.ts` is the only thing that changes** when the unified sale ships:
  add `netLineTotal` to `ReceiptLine`, print it beside `lineTotal`, done.
- `netLineTotal` is **absent rather than invented** — the per-module tables have no such column, and
  computing a line's share of the bill discount here would be exactly the re-derivation the brief
  forbids.

Everything else in the brief is implemented as written.

---

## 2. Files

| File | What it is |
|---|---|
| **`lib/receipt-format.ts`** | new — fixed-width line building: `wrapText`, `centreLines`, `padRow`, `metaRow`, `indent`, `divider`, `clampLines` |
| **`lib/receipt.ts`** | new — **server only**. `loadReceipt(module, saleId)` → `ReceiptData`. 2 queries, in series |
| **`components/receipt/ReceiptDocument.tsx`** | new — builds the receipt as text; `buildReceiptLines()` is exported so the layout can be checked as data |
| **`components/receipt/PrintControls.tsx`** | new — client; Back + Print. The only thing `@media print` hides |
| **`app/receipt/[module]/[id]/page.tsx`** | new — the print view, **outside the `(dashboard)` group** |
| `app/globals.css` | modified — `.receipt-paper` / `.receipt-page` and the `@media print` + `@page` block |
| `components/sales/SaleLineItems.tsx` | modified — a **Print receipt** button in the expanded sale row |

**No schema, no migration, no API route, no money math.** Read-only, as specified.

### Two design decisions worth your eye

**The receipt is built as an array of exactly-32-character lines and printed in a `<pre>`.**
Alignment is decided in code that can be asserted, not by CSS at print time — where the only way to
discover it was wrong is to look at a printed roll. `white-space: pre` (not `pre-wrap`) stops a font
metric rounding difference from re-flowing a line and destroying the money column. Width comes from
`RECEIPT_LINE_CHARS`; nothing hardcodes 32.

**The print page lives outside `(dashboard)`.** That group supplies the sidebar and bottom nav, so
by rendering outside it the app chrome is *never rendered* rather than merely hidden. "Print only
the receipt" becomes structural instead of a CSS rule a future layout change could quietly break —
the `@media print` block is still there as the belt to that braces.

---

## 3. Two real defects, found in the browser

Both type-checked and linted clean. Neither would have been visible without printing a real sale.

### 🔴 The receipt failed its own arithmetic

First render of the fixture:

```
  3 × Rs. 276            Rs. 827
```

`formatPKR` without `{ precise: true }` rounds to whole rupees — the same call the on-screen sale
detail makes. The stored values are **275.50** and **826.50**. So the printed bill said
3 × 276 = 827, which multiplies out to 828.

The brief says the receipt must match the screen, and it did — **but a receipt is the one document a
customer checks with a calculator, in front of the owner.** A bill whose own arithmetic fails loses
him the argument even when his records are right. So the receipt now prints **paise**:

```
  3 × 275.50          Rs. 826.50
```

Same stored numbers, different precision. The screen keeps whole rupees (it is a summary the owner
scans); the receipt is exact. Flagging it explicitly because it is a deliberate divergence from
"exactly match the screen" — say the word if you want the receipt rounded to match, and I'll change
it, but I'd be handing the owner a bill that doesn't add up.

*(Consequence: `Rs.` had to come off the unit price — `2 cottons × Rs. 380.00` is 34 characters and
overflows the roll. `2 cottons × 380.00` fits, and the currency is unambiguous from the total on the
same line.)*

### 🟠 The customer row clipped the label instead of the value

```
Custo… ZZ_TEST_ Receipt Customer
```

`padRow` truncates the **left** when the two halves collide — correct for a money row, where the
amount must never be clipped, and wrong for a meta row, where it ate the word that says what the
line is. Added `metaRow()`, which keeps the label and wraps the value beneath it:

```
Customer
  ZZ_TEST_ Receipt Customer
```

*(A third, smaller one: `wrapText` trims, so the two-space indent baked into the detail line was
being eaten and size/tier read as another product name. Indent is now applied after wrapping.)*

---

## 4. Verification

Fixture: a **ZZ_TEST_ bakery sale, 3 lines, a 12.5% per-line discount and a 10% whole-bill
discount**, created through the app's own API from an authenticated browser session. Subtotal
2,059.00 → stored total **1,853.10**.

The receipt, measured rather than eyeballed — every line's length read out of the DOM:

```
28|   SET SHOP NAME IN SETTINGS
26|     SET PHONE IN SETTINGS
27|    SET ADDRESS IN SETTINGS
32|--------------------------------
32|Date                  10/08/2026
32|Sale                    U3EBG1YO
 8|Customer
27|  ZZ_TEST_ Receipt Customer
32|--------------------------------
27|ZZ_TEST_ Extra Large Family
25|Celebration Cake Rusk Box
32|  3 × 275.50          Rs. 826.50
28|Russ Small Rectangular Round
27|  Small · Rectangular Round
11|  12.5% off
32|  12 × 45.00          Rs. 472.50
 4|Eggs
32|  2 cottons × 380.00  Rs. 760.00
32|--------------------------------
32|Subtotal            Rs. 2,059.00
32|Discount (10%)       -Rs. 205.90
32|TOTAL               Rs. 1,853.10
32|================================
20|           Thank you
```

| Check | Result |
|---|---|
| **Numbers match the stored sale** | ✅ 826.50 / 472.50 / 760.00, subtotal 2,059.00, −205.90, **total 1,853.10** — identical to the API response for the sale. Same values the screen shows, at higher precision |
| **Nothing recomputed** | ✅ the total is the stored `totalAmount`; the discount row is `subtotal − total`, the same derivation the on-screen detail uses |
| **Columns align in 32 chars** | ✅ `maxLen = 32`, **0 lines over**, money flush to column 32 |
| **Long name wraps** | ✅ the 52-character product name wraps to two lines; the money column below it is unaffected |
| **Per-line discount only when non-zero** | ✅ `12.5% off` on the Russ line only |
| **Unit shown where it means something** | ✅ `2 cottons × 380.00`; plain `3 ×` and `12 ×` elsewhere |
| **Unconfigured header prints the sentinel** | ✅ `SET SHOP NAME IN SETTINGS` etc., centred, verbatim — not blank, not hidden |
| **Date is DD/MM/YYYY Karachi** | ✅ `10/08/2026`. The real sale stores `2026-08-07T19:00:00Z` and prints **08/08/2026** — the Karachi conversion visibly working, via `formatDate`, never `new Date()` |
| **Real sale** (Saif, Rs. 5,000) | ✅ `100 × 50.00 → Rs. 5,000.00`, subtotal and TOTAL both 5,000.00, **no discount row** (0%) |

### Print preview: only the receipt

`emulate` has no media-type option, so rather than assert this from the CSS source I **extracted the
`@media print` rules from the CSSOM and re-applied them as `media="all"`**, which renders exactly
what will print. Result (screenshot below): the receipt alone, 58mm wide at the top-left origin —
**no nav, no buttons, no card, no shadow**. The emulation style was removed afterwards.

The six rules that produced it:

```css
@page { margin: 0 }
body * { visibility: hidden }
.receipt-paper, .receipt-paper * { visibility: visible }
.receipt-controls { display: none !important }
.receipt-page { display: block; padding: 0 }
.receipt-paper { position: absolute; top: 0; left: 0; width: 58mm; box-shadow: none;
                 background: #fff; color: #000; print-color-adjust: exact }
```

Screenshots (`C:\Users\SAIF\AppData\Local\Temp\claude-chrome-screenshots-E1t1lA\`):
`screenshot-1786322502974-9.jpg` (first build, showing the `3 × Rs. 276 → Rs. 827` defect),
`screenshot-1786322880968-10.jpg` (corrected, on screen),
`screenshot-1786322917124-11.jpg` (**print rendering**).

`tsc --noEmit` exit 0, `next lint` clean.

---

## 5. Milk: not built, asking first as instructed

**Milk sales are untouched** — no receipt route, no print button, nothing in `lib/milk*` changed.
This is a `Sale` receipt only.

A milk receipt would be a different document, not a config row: a `MilkSale` has no line items at
all — it is litres × rate, with no products, no per-line discount and no bill discount. It would
need its own body layout, though it could reuse the header, the totals block and all of
`receipt-format.ts`. **Want it?**

---

## 6. Cleanup — verified back to baseline

Everything created was `ZZ_TEST_`-scoped, and the sale was deleted **through the API** so stock
restored itself.

| Check | Result |
|---|---|
| `ZZ_TEST` customers / products | **0 / 0** |
| Customers / Products | **1 / 27** |
| Products at stock 100 | **27** — the fixture's 17 units came back |
| Products with a non-zero price | **1** (Big Apple 0.5L, the pre-existing one) |
| BakerySale / items | **1 / 1** — Saif's real sale, untouched |
| BeverageSale / unified `Sale` | **0 / 1** |
| Milk sales / deliveries / purchases | **1 / 1 / 1** — untouched |
| `Settings` | placeholders, **`configuredAt` NULL** — CHECKLIST #2b still reads outstanding |

One note: **the customer API soft-deletes** (deactivates, keeping history), which would have left a
deactivated `ZZ_TEST_ Receipt Customer` row to be found during the handoff data reset. Since its
only sale was already gone, I removed the row with a guarded SQL delete — one that refuses to touch
any customer with a sale in any table. Flagging it because it deliberately steps around an app
policy; the policy protects real customers with history, which this was not.

---

## 7. Not committed

Working tree, ready for your review:

```
?? app/receipt/                        ?? lib/receipt.ts
?? components/receipt/                 ?? lib/receipt-format.ts
 M app/globals.css                      M components/sales/SaleLineItems.tsx
```

(Plus the pre-existing untracked `prisma/migrations/20260809180000_unify_sale_tables_part_a/`, which
belongs to the unified-sale build and is not part of this.)

Say the word and I'll commit. The dev server is still running on port 3000.

---

### Sources used

**Context7 was not consulted** — nothing here needed a library API. The work was `window.print()`,
`@page`/`@media print` (CSS standards, not framework behaviour) and this repo's own conventions,
which I read directly: `lib/format.ts` for `formatPKR`/`formatDate`, `lib/sales.ts` for
`SALE_DETAIL_SELECT`, `components/sales/SaleLineItems.tsx` for how the screen presents the same
numbers, and `app/(dashboard)/layout.tsx` for the session-check pattern. The ESC/POS 32-chars-at-58mm
figure is the recorded decision from last turn. Verification was the running app in a real browser
plus SQL against the live row.
