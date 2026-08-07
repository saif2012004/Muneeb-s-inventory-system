# Response — Phase 4 label fix, re-verified, committed, deployed

**Date:** 7 Aug 2026
**Task:** apply label option 3, re-verify the three cases in-browser, commit Phase 4, confirm
ignores, push, preview deploy, mark Phase 4 ✅.
**Outcome:** all done. Commit **`699f884`**, preview build **green**. Stopped.

---

## 1. Label fix — option 3 applied

The rule now lives on the **unit**, not the module — one predicate, no per-module branching,
exactly as asked.

`lib/sale-catalog.ts`:

```ts
const SELF_EVIDENT_UNITS = new Set(["bottle", "piece"]);

export function unitIsInformative(unit: string | null): unit is string {
  return Boolean(unit) && !SELF_EVIDENT_UNITS.has(unit as string);
}
```

Three call sites read from it: `quantityFieldLabel()`, the new `unitPriceFieldLabel()` (the
price label was previously inlined in the component — moved out so both labels obey one rule),
and `formatQuantityWithUnit()`. The line-summary row in `LineItemRow` also suppresses its
quantity prefix for self-evident units, so "12 pieces · Line total" is now just "Line total".

Resulting matrix:

| Unit | Quantity label | Price label | Quantity summary |
|---|---|---|---|
| `cotton` (Eggs) | **Quantity (cottons)** | **Price per cotton** | **3 cottons** |
| `bottle` (beverages) | Quantity | Unit price | *(suppressed)* |
| `piece` (plain bakery) | Quantity | Unit price | *(suppressed)* |
| none | Quantity | Unit price | *(suppressed)* |

Adding a genuinely ambiguous unit later — say `crate` — gets the suffix automatically without
touching either module.

---

## 2. Browser re-verification — the three you asked for

Fresh dev server, isolated context, throwaway login (`zz_test_lbl@…`, deleted after).

| # | Check | Result |
|---|---|---|
| 1 | **Beverages back to committed wording** | **PASS** — `Quantity` / `Unit price`, both before and after selecting Pepsi 1.5L. Line summary reads plain "Line total". The word "bottle" appears **nowhere** in the row |
| 2 | **Eggs keep the cotton wording** | **PASS** — `Quantity (cottons)` / `Price per cotton`, summary **"3 cottons · Line total"**, Rs. 750 |
| 3 | **Plain bakery item gets no suffix** | **PASS** — Buns reads `Quantity` / `Unit price`, summary plain "Line total", and the word "piece" appears **nowhere** in the row |

Check 1 matches committed `72fc56d` — beverages is effectively unchanged again.

Both bakery rows were on screen together, which makes the contrast the point of the fix:
Eggs carrying its suffix, Buns plain, in the same form.

Also re-ran the pure-logic matrix (16 assertions across all four unit cases) — **all passed**
— before touching the browser.

---

## 3. Committed — `699f884`

```
feat: phase 4 - bakery module + lift sale components to shared
25 files changed, 1716 insertions(+), 280 deletions(-)
```

The body calls out both things you asked for: that the eight components moved to
`components/sales/` parameterised by module, and that `lib/sales.ts` absorbed
`SALE_LIST_SELECT` / `SALE_LIST_ORDER` / `buildSaleDateWindow()` so the two routes can't drift.

**Git recorded all eight moves as renames**, not delete+add — so `git log --follow` still
reaches the Phase 3 history for every one:

```
rename components/{beverages => sales}/CustomerCombobox.tsx  (93%)
rename components/{beverages => sales}/DeleteSaleDialog.tsx  (100%)
rename components/{beverages => sales}/LineItemRow.tsx       (63%)
rename components/{beverages => sales}/NewSaleForm.tsx       (78%)
rename components/{beverages => sales}/ProductPicker.tsx     (65%)
rename components/{beverages => sales}/SaleDatePicker.tsx    (100%)
rename components/{beverages => sales}/SaleLineItems.tsx     (77%)
rename components/{beverages => sales}/SalesList.tsx         (88%)
rename lib/hooks/{use-beverage-sales.ts => use-sales.ts}     (60%)
rename lib/validations/{beverage-sale-form.ts => sale-form.ts} (100%)
```

Pushed: `3d299ef..699f884`.

### Ignores confirmed

| Pattern | Status |
|---|---|
| `.env`, `.env.local`, `.env.production` | ignored (`.gitignore:32`) |
| `.vercel`, `.vercel/project.json` | ignored (`.gitignore:36`) |
| `docs/prompt.txt` | ignored (`.gitignore:46`) |
| Tracked env files | only `.env.example` — placeholders |

---

## 4. Preview deploy — GREEN

| | |
|---|---|
| Result | **READY**, `✓ Compiled successfully` |
| `target` | **preview** (confirmed via `vercel inspect`; production untouched) |
| URL | `https://muneeb-inventory-system-wj3l529mf.vercel.app` |
| Middleware | **78.2 kB** — unchanged, Edge split holds |

### The refactor paid for itself in the bundle

| Route | Before (Phase 3.2) | Now |
|---|---|---|
| `/beverages` | 4.44 kB | **158 B** |
| `/beverages/new-sale` | 31.8 kB | **167 B** |
| `/bakery` | — | **158 B** |
| `/bakery/new-sale` | — | **166 B** |

The per-route payload collapsed because the shared components now live in the common chunk
instead of being duplicated per route. First Load JS is 222 kB / 286 kB — **bakery costs the
same as beverages did**, i.e. the second module was effectively free.

All four new API routes registered: `/api/bakery/sales`, `/api/bakery/sales/[id]`, plus the
existing beverages pair.

### Live auth checks (signed out)

| Request | Result |
|---|---|
| `GET /api/bakery/sales` | **401** `{"data":null,"error":"You must be signed in."}` |
| `GET /bakery` | **307** → `/login?callbackUrl=…%2Fbakery` |
| `GET /bakery/new-sale` | **307** → `/login?callbackUrl=…%2Fbakery%2Fnew-sale` |
| `GET /beverages` | **307** → `/login?callbackUrl=…%2Fbeverages` |

---

## 5. CLAUDE.md updated

**Phase 4 marked ✅.** Added a carried-forward block recording what later modules inherit:

1. Sale components are **shared** in `/components/sales/`, parameterised by `SaleModule` —
   Milk should add a config row, not a third copy. Forking one is the signal to parameterise.
2. **Query keys are module-scoped**; without the segment one list shows the other's cached rows.
3. **Unit suffix only when the unit adds information** — `SELF_EVIDENT_UNITS`, a property of
   the unit, not the module. No per-module branching.
4. **Picker labels use every attribute a product carries** — size+discount alone made
   Biscuits Premium/Simple and all four Russ variants indistinguishable.

---

## 6. State

- `git status` clean, `main` up to date with `origin/main`.
- Database at **exact baseline**: 1 user (`i228767@nu.edu.pk`), 0 customers, 0 sales in either
  module, 62 products all active at price 0, 2 categories / 11 sub-categories. No sales were
  saved during this pass; the only test artifact was the throwaway login, now deleted.
- Nothing promoted to production.

| Phase | Status |
|---|---|
| 1–3 | ✅ Done |
| **4** | **✅ Done** |
| 4b | ⬜ Customers hub + receivables |
| 5–8 | ⬜ |

Stopped.
