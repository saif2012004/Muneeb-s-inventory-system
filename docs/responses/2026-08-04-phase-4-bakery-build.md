# Response — Phase 4 (Bakery) built, not yet verified

**Date:** 4 Aug 2026
**Task:** build the bakery module by reusing Phase 3, handle where bakery genuinely differs,
produce a manual test list, then stop.
**Outcome:** built, type-checked, lint-clean. **Not browser-verified. Not committed.**

Full detail + the 44-step test list: **`docs/phase-4-bakery-module.md`**.

---

## 1. Two pre-flight findings that changed the design

**`BakerySale` / `BakerySaleItem` are column-for-column identical to beverages** — verified via
Supabase MCP. That identity is what justifies sharing components; it's a schema fact, not an
assumption.

**The Phase 3 label logic would have broken bakery.** It composed picker labels from size +
discount only. On bakery that makes products **indistinguishable**:

| | Would have rendered as |
|---|---|
| Biscuits Premium / Biscuits Simple | both "Biscuits" |
| All four Russ variants | "Large" / "Large" / "Small" / "Small" |

Two identical rows in a picker is a way to record the wrong sale. Fixed by composing the label
from **every** attribute a product carries — size, `qualityTier`, `shape`, discount.

Also: **`discountPercent` is `0`, not `null`,** on every bakery product, so the truthy check is
load-bearing — a loose check would print "0% off" on all ten.

---

## 2. Lifted, not forked

Took the brief's preferred option. All eight components moved with `git mv` (history preserved)
to `/components/sales/`, parameterised by a `SaleModule`:

```
NewSaleForm  LineItemRow  ProductPicker  CustomerCombobox
SaleDatePicker  SalesList  SaleLineItems  DeleteSaleDialog
```

Both pages are now four lines — `<SalesList module={BAKERY_MODULE} />`. Milk sales later should
mean a config row, not another copy of the form.

Reused unchanged, as instructed: `reconcileSaleLines()`, `SALE_DETAIL_SELECT`,
`loadSaleProducts()`, the money helpers, and the global Query settings (untouched).

I also pulled three more things into `lib/sales.ts` so the two API routes can't drift on them
either: `SALE_LIST_SELECT`, `SALE_LIST_ORDER` (the stable newest-first tiebreak) and
`buildSaleDateWindow()` (the Karachi window + backwards-range rejection). The beverages route
now imports them too.

Deleted as superseded: `lib/beverage-catalog.ts`, `lib/hooks/use-beverage-sales.ts`.

---

## 3. Bakery-specific handling

| Case | Handling |
|---|---|
| Attribute-less products (Buns, Eggs) | Row falls back to the **brand**, so it reads "Buns" rather than a blank row under a "Buns" heading |
| Eggs by the cotton | Field becomes **"Quantity (cottons)"**, price **"Price per cotton"**, line reads **"3 cottons"**, expanded row **"3 cottons × Rs. 250"**. Singular handled |
| Russ ×4 | Size **and** shape in the label and the expanded row. `SALE_DETAIL_SELECT` gained `qualityTier` + `shape` for this |
| Price 0 | Unchanged from beverages — editable price, amber "set price" hint |

**Verified in isolation** against the exact seeded rows: all four Russ variants distinct, both
Biscuits distinct, Buns/Eggs degrade correctly, no "0% off" leaked, cotton pluralisation right.
**Beverages labels unchanged** in the same run (`Pepsi › 1.5L › 30% off`, full-price sorts
first).

---

## 4. What I am NOT claiming

**This has not been verified in a browser, and I'm not saying it works.**

`tsc` and lint are clean, and the label logic is unit-verified — but those are exactly the
checks Phase 3.2 also passed while carrying three real bugs, one of which left the owner with
no way to recover. A new form layout gets its own chance to behave wrong.

The riskiest untested area is **§6.4 — the beverages regression**. I changed eight components
that beverages depends on. Type-checking proves the wiring compiles; it does not prove the
blue screens still behave, that the Phase 3.2 fixes survived, or that switching modules doesn't
show stale rows from the other module's cache.

---

## 5. State

- **Not committed.** `git status` shows the moves, the new bakery files and the two new lib
  modules, all unstaged.
- No migration, no schema change, no change to the global Query settings.
- Nav already routes `/bakery` with the amber accent — no change needed there.

**Next step is yours:** the browser verification pass over §6 of
`docs/phase-4-bakery-module.md`. Say the word and I'll run it the same way as Phase 3.2 —
`ZZ_TEST_`-scoped data, isolated browser context, failures reported before fixes, DB restored
to baseline afterwards.
