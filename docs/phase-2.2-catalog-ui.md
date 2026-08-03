# Phase 2.2 — Catalog UI

**Status:** Complete, browser-verified, committed and pushed
**Date:** 2026-08-03
**Commit:** `ba807d6` — `feat: phase 2.2 - catalog UI with guarded-delete handling`
**Pushed:** `082d24d..ba807d6`
**Scope:** Catalog manager UI + a small structured-payload change to the 2.1 API. Seed still NOT run.

---

## 1. What was built

The catalog manager at `/catalog`: an accordion of categories, each expanding to its
sub-categories and their product tables. Full CRUD at all three levels, an inline price
editor, and a "show inactive" toggle.

| File | Purpose |
|---|---|
| `app/(dashboard)/catalog/page.tsx` | Route shell → `/catalog` |
| `components/catalog/CatalogManager.tsx` | Orchestrator: accordion, dialogs, states, toggle |
| `components/catalog/ProductTable.tsx` | Table, row `layout` animation, row actions |
| `components/catalog/InlinePriceEditor.tsx` | Click-to-edit price cell |
| `components/catalog/NameDialog.tsx` | Add/rename for category + sub-category |
| `components/catalog/ProductDialog.tsx` | Add/edit product |
| `components/catalog/DeleteDialog.tsx` | Confirm + 409 refusal handling |
| `lib/api-client.ts` | Centralized fetch, `ApiError`, 401 handling |
| `lib/hooks/use-catalog.ts` | TanStack Query: 2 queries, 9 mutations |
| `lib/catalog-display.ts` | Label / accent / price-format helpers |

14 files, +2268 / −24. `tsc --noEmit` clean, `next lint` clean.

### Design System compliance

- **Accents** — Beverages blue, Bakery amber, matched on category *name* (the owner can
  create categories, which have no fixed id). Unknown names fall back to neutral zinc rather
  than borrowing a module colour. Milk is deliberately absent: it is not a catalog category.
- **Three states** — Skeleton rows while loading, a designed `EmptyState` per sub-category
  ("No products yet. Add one."), and an error state with a retry button.
- **Motion** — Framer `layout` + `AnimatePresence` on table rows, gated behind
  `useReducedMotion()`.
- **Numbers** — `tabular-nums` throughout, money via `formatPKR`, `inputMode="decimal"` on
  the price input, 44px minimum touch targets.
- **Toasts** on every create / update / delete, success and error.
- Every destructive action confirms first; every submit button spins and disables.

---

## 2. Three conflicts in the brief — resolved, not silently ignored

1. **`PATCH /api/products/[id]/price` does not exist.** The instruction was also not to change
   the 2.1 routes. The inline editor therefore sends `{ price }` to `PATCH /api/products/[id]`;
   the 2.1 route treats an omitted field as unchanged, so a price-only patch is exactly this.
2. **`/app/catalog/page.tsx` would have collided.** `app/catalog/` and
   `app/(dashboard)/catalog/` both resolve to `/catalog` — a Next route conflict. Used the
   `(dashboard)` group per CLAUDE.md: same URL, and it keeps the nav shell.
3. **"Deactivate instead" placement.** A product delete never 409s (the API auto-soft-deletes),
   so that button sits on the product delete dialog as a pre-emptive choice. See §4 for what
   happens on a category/sub-category 409.

---

## 3. Sub-category count now tracks the "Show inactive" toggle

Previously the count came from the API's `_count.products`, which counts **all** products —
so with the toggle off it could read "3" above two visible rows.

Now derived from the rows actually rendered, which makes disagreement structurally impossible
rather than merely currently correct.

Verified against a fixture of 3 products (2 active, 1 inactive):

| Toggle | Count shown | Rows rendered |
|---|---|---:|
| Off | `3` → **`2`** | 2 |
| On | **`3 (1 inactive)`** | 3, one badged `Inactive` |

Screen readers get a spoken form via `aria-label`: *"ZZR Sub, 3 products, 1 inactive"*.

`productCount` is still returned by the API — it is now used only for the "All products here
are deactivated. Turn on Show inactive to see them." hint, which is not a count.

---

## 4. Structured 409 payload (small 2.1 change)

### Server

- `findProductsWithSaleHistory` switched from `findMany` + `distinct` to `groupBy`, so it
  returns a per-product **`saleCount`** rather than just which ids appear.
- New `failBlocked()` in `lib/api.ts` returns:

  ```json
  { "data": null,
    "error": "Can't delete \"Pepsi\" — 1 product has sales recorded against it (Pepsi 1.5L). Deactivate those products instead so past sales stay intact.",
    "blockedBy": [{ "id": "clx…", "name": "Pepsi 1.5L", "saleCount": 2 }] }
  ```

- Both guarded routes (`categories/[id]`, `subcategories/[id]`) now use it. **The prose
  `error` is unchanged and remains the fallback** for any client that ignores the new field.

### Client

`ApiError` carries `blockedBy`. The delete dialog renders that list — it never parses the
message. This also closes a latent gap: the prose truncates to "and N more" past three
products, while the structured list shows every one.

### Proven, not just wired

Exercised with a temporary fixture (two sale lines on one product):

> **This can't be deleted**
> Can't delete "ZZR Sub" — 1 product has sales recorded against it (ZZR Sold). Deactivate
> those products instead so past sales stay intact.
>
> **ZZR Sold** — 2 sales
>
> *Deactivating retires these products from new sales. It does not make this deletable — the
> sales history is kept either way.*

Clicking **Deactivate these**, then checked directly in the database:

| Check | Result |
|---|---|
| Blocking product deactivated **by id** | ✅ true |
| **Untouched product still active** | ✅ true — proves it acted on the ids, not the whole subtree |
| Sale lines intact | ✅ 2 |
| Sub-category correctly **not** deleted | ✅ true |

### One deliberate omission

**"Deactivate these" does not retry the delete.** Deactivating does not unblock it — the guard
checks *sale history*, not `isActive`. Wiring a retry would produce a button that appears to
fix the problem and then fails on the next click. The panel says so plainly instead.

---

## 5. Four defects found by browser testing, all fixed

| # | Defect | Fix |
|---|---|---|
| 1 | Create-product price field defaulted to `"0"`, so tapping and typing `250` produced **`0250`** | Field starts blank with a `0` placeholder; blank submits as 0 |
| 2 | `formatPKR` rounds to whole rupees — a stored `312.50` displayed as **"Rs. 313"**, misleading where the number *is* what you're editing | New `formatCatalogPrice`: paise shown only when the value has them |
| 3 | Sub-category heading read as **"Pepsi1"** to screen readers | `aria-label` with the spoken form |
| 4 | Duplicate chevrons on category rows (accordion caret + menu caret) | Menu now uses an overflow "···" |

---

## 6. Manual test list

1. **Add category** — "Add category" → name → appears as an expanded accordion.
2. **Add sub-category** — category "···" → Add sub-category → shows with a `0` count and
   "No products yet. Add one."
3. **Add product** — "Add product" → name, price, Size `1.5L` → row appears, price renders
   `Rs. 250`.
4. **Edit price inline** — click the price → input → type `312.5` → **Enter** → shows
   `Rs. 312.50` with a confirming toast. **Esc cancels**, blur also commits.
5. **Toggle inactive** — row "···" → Deactivate → row leaves the list, count drops, empty
   state explains why. Flip **Show inactive** → row returns dimmed with an `Inactive` badge,
   price editing disabled, count reads `N (M inactive)`. → Reactivate.
6. **Attempt a delete** — product without sales → hard-deleted; sub-category / category
   without sales → cascades to clean children.

---

## 7. Open item for Phase 3

**The 409 "Deactivate these" flow needs a real re-test once sales exist.**

It is wired against the structured payload and was exercised here, but only because sale
history was manufactured for the test and then removed. It cannot arise in normal use until
the Beverages/Bakery sale modules land in Phase 3. Noted in the commit message too.

---

## 8. State

| | |
|---|---|
| 2.2 catalog UI | ✅ committed and pushed (`ba807d6`) |
| 2.1 structured 409 payload | ✅ included in the same commit |
| `tsc --noEmit` / `next lint` | ✅ clean |
| Database | untouched — **0 rows** across all catalog and sales tables, `User` at 1 |
| Temp files | all removed; working tree clean |
| **Seed (2.3)** | ⛔ still **not run** |

### Incidental note

While testing on port 3005, unauthenticated redirects landed on `localhost:3000/login` — the
other app running on that port. That is `NEXTAUTH_URL` pointing at 3000, which is correct for
normal use; it was overridden per-process for the test only, and no file was changed.
