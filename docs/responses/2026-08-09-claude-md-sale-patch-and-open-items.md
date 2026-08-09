# CLAUDE.md — the UI-less sale PATCH, and re-prioritising the column drop

**Date:** 2026-08-09
**Commit:** `19ee21b` — *docs: log the UI-less sale PATCH and re-prioritise the discount-column drop* (pushed to `main`)
**Scope:** documentation only. No code, no schema, no migration, no database change, no test data.

---

## 1. The UI-less sale PATCH — logged, and framed as a trap

Written up in the carried-forward notes with a ⚠️ and an explicit opening line: **it is not dead
code.** That framing is the point of the entry. A route that is complete, tested, and called by
nothing is the single easiest thing in this repo to delete during a tidy-up, and the reasoning
that makes it correct to keep lives entirely outside the code.

What the entry records:

- **What exists** — `PATCH /api/{beverages,bakery}/sales/[id]` reconciles line edits through
  `reconcileSaleLines`, carries the **discount** snapshot, and reconciles **stock** by delta:
  quantity difference, line removal, line addition, product swap, and same-product netting, all
  in one transaction.
- **What doesn't** — any way to reach it. No `useUpdateSale`; the beverages/bakery lists offer
  Delete only. Noted that milk sales *do* have an edit dialog, so the two modules sharing
  `reconcileSaleLines` are precisely the ones without a screen — which is the detail that makes
  the gap look like an oversight when it isn't.
- **How it was verified** — API over real HTTP in an authenticated browser session, with
  before/after stock numbers, pointing at
  `docs/responses/2026-08-09-stock-tracking-shipped.md` §3–4.
- **Where the UI lands** — with the unified cross-category sale, deliberately not standalone,
  with your reasoning: that rework rebuilds the sale form anyway, so an edit screen written
  against the current per-module structure would be built to be thrown away. The route already
  being stock- and discount-aware is what makes deferring it safe rather than merely cheap.

I added one line beyond the brief, because it is the thing that will actually happen:

> If someone reports "editing a sale doesn't work", the answer is that there is no edit screen
> yet — not that the reconciliation is broken.

The failure mode of this note being absent isn't only deletion. It's a future session spending
an afternoon debugging working code because the symptom ("I can't edit a sale") points at the
reconciliation rather than at the missing screen.

---

## 2. `Product.discountPercent` drop — promoted to next in line

The entry previously said *"Do it AFTER stock."* Stock shipped, so that gate is gone and the item
now reads **NEXT IN LINE**, with the only remaining condition being a slot.

Added the third thing that must ship in the same change, which the earlier entry missed:

| Must go together | Why |
|---|---|
| The DB column | the actual removal |
| `SALE_DETAIL_SELECT`'s join in `lib/sales.ts` | still joins `product.discountPercent` |
| **The catalog's "Discount" table column** | renders **"—" on all 27 rows** — pure noise |

Kept as one change rather than three, for a concrete reason now stated in the file: dropping the
database column without removing the table column would break the catalog page. They are not
independent cleanups that happen to be related.

The existing guardrail — *do not read `product.discountPercent` for a sale line* — was left in
place, since it stays true right up until the column is gone.

---

## 3. Context7

Stays a Phase 8 diagnosis item, as you said. Corrected the count: the entry said **6** consecutive
failed sessions and it is now **8**. Small, but the number is the argument for treating it as a
broken tool rather than a blip, so a stale one weakens the item.

---

## What changed

| File | Change |
|---|---|
| `CLAUDE.md` | **+32 / −10.** Every removed line is part of a rewritten block (the column-drop item and the Context7 count) — nothing was dropped. |

No other file touched. No code, schema, migration or DB change, and no test data created, so
there was nothing to clean up and Saif's records were never in scope this turn.

---

## Next

Stopping here. The unified cross-category sale is the next big gated change, and it now has two
things waiting for it that are worth carrying in:

1. **The sale-edit UI**, per §1 — the server side is done and proven, so that rework inherits
   edit for free rather than having to build the reconciliation as well.
2. **The `SaleModule` parameterisation** in `lib/sale-modules.ts` and the shared components in
   `/components/sales/` are the current seam between beverages and bakery. A cross-category sale
   is precisely the thing that seam was not designed for — a sale is single-module today at the
   schema level too, with separate `BeverageSale` / `BakerySale` tables. That is a schema
   question before it is a UI one, so I'd expect the same stop-and-confirm migration treatment as
   the discount delete and stock.
