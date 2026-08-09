# Stock tracking — shipped

**Date:** 2026-08-09
**Commit:** `d0ed825` — *feat: stock tracking per product, reconciled through reconcileSaleLines* (pushed to `main`)
**Migration:** `20260809120000_add_product_stock` — applied after your go-ahead.

One integer per product, moved only by sales, reconciled from the same split
`reconcileSaleLines` already produces.

---

## 1. Post-migration state (checked before anything was built on it)

| Check | Result |
|---|---|
| Products | **27** |
| Products at `stock = 100` | **27** |
| Products NOT at 100 | **0** |
| Column shape | `integer / NOT NULL / default 100` |
| Variant rows | 0 |
| Saif's bakery sale resolves | **5000.00 → Buns ×100** |
| Big Apple 0.5L price | 120.00 (only priced product) |
| Customer / Farmer | 1 / 1 |
| Milk sales / deliveries / purchases | 1 / 1 / 1 |
| RLS on `Product` + the 4 sale tables | **enabled `true`, force `false`** |

`ADD COLUMN` left both RLS flags alone, as expected. Nothing but the new column moved.

---

## 2. The logic

`computeStockDeltas()` in `lib/sales.ts` consumes the **same** `updates` / `creates` /
`removedIds` split that produced the line writes — there is no second diff:

| Case | Delta |
|---|---|
| `creates` | `−qty` |
| `removedIds` | `+storedQty` |
| `updates`, same product | `+storedQty − newQty` — **the difference** |
| `updates`, product swapped | `+storedQty` on the old, `−newQty` on the new |

Keyed by **product**, not line, so two lines of the same item become one adjustment rather than
two writes racing to read-modify-write one row. Net-zero products are dropped, so re-saving an
unchanged 100-line sale writes nothing at all.

**Blocking** returns every short product (not the first), as `shortBy`:

```json
{ "productId": "...", "name": "Coke Cola 1.5L", "available": 8, "requested": 15, "shortfall": 7 }
```

Same contract as the delete guard's `blockedBy` — prose for reading, fields for acting on.

**Two independent guarantees**, deliberately:

1. `findStockShortfalls` produces the friendly, structured refusal.
2. `applyStockDeltas` writes through a **conditional** `updateMany`
   (`WHERE id = ? AND stock >= -delta`), so "never negative" is enforced by the *database*, not
   by the check. A `count` of 0 raises `StockConflictError` and aborts the transaction.

The pre-check exists for the message; the WHERE clause exists for the guarantee.

**Cost: zero extra queries.** `stock` rides along in `SALE_PRODUCT_SELECT`, which every sale
route already loads to validate products. At `connection_limit=1` an extra read would have been
a real ~1s of the owner's time.

All stock work runs inside the sale's existing transaction, in series, no `Promise.all`. Stock is
written **first**, so its guard aborts before any sale row exists.

---

## 3. Verified with numbers

### Through the UI

| Case | Numbers | Result |
|---|---|---|
| Stock editor | 100 → 20 | ✅ |
| **Create** qty 12 | 20 → **8** | ✅ |
| **Block** 15 against 8 | 409, *"8 in stock · needs 15 · short by 7"* | ✅ nothing written, stock still 8, still 1 sale |
| **Restock inline** | 8 → **40**, without leaving the form | ✅ |
| **Retry** | 40 → **25** | ✅ |
| **Delete** the qty-15 sale | 25 → **40** — up by exactly 15 | ✅ |

### The edit reconciliation

| Case | Numbers | Result |
|---|---|---|
| **Quantity 12 → 8** | 40 → **44** — **UP by exactly 4** | ✅ not down by 8 |
| Add a line (Pepsi ×5) | Pepsi 100 → **95**, Coke unchanged at 44 | ✅ |
| Product swap (Pepsi → Coke, ×5) | Pepsi 95 → **100** restored, Coke 44 → **39** | ✅ |
| Remove a line | 39 → **44** | ✅ |
| Two lines, same product | see below | ✅ |

**The Map case, made discriminating.** Netting `+5` and `−6` to `−1` gives the same final number
as applying them separately, so that alone proves nothing. I set stock to **5** first, then sent
one save containing line 1 `8 → 3` (`+5`) *and* a new line of `6` (`−6`):

- **Netted (correct):** one `−1` → **5 → 4**. ✅ observed
- **Per-line (wrong):** the `−6` hits `WHERE stock >= 6` against 5 and the save is refused

So the result distinguishes the two implementations rather than merely being arithmetically
consistent with both.

### Bakery, milk, Saif

| Check | Result |
|---|---|
| Bakery create | 201, Buns 100 → 90 |
| Bakery block | 409 with `shortBy` `{available: 90, requested: 5000, shortfall: 4910}` |
| Bakery delete | 90 → **100** restored |
| Milk | **no stock concept anywhere** — `/milk/sales` contains no "stock" text; 1/1/1 untouched |
| Saif's bakery sale | resolves, Rs. 5,000 |

---

## 4. One thing you should know: there is no edit-sale UI

**Beverages and bakery have no way to edit a sale.** The `PATCH` route exists, is fully
implemented and is now stock-aware — but nothing in the app calls it. `useUpdateSale` does not
exist; the sale list offers Delete only. (Milk sales *do* have an edit dialog; the two modules
that use `reconcileSaleLines` do not.)

So the edit cases above were exercised **against the API through the authenticated browser
session**, not through a screen. That is a genuine end-to-end test of the server logic over real
HTTP — it is not a weaker check of the reconciliation — but it is not a UI test, and I would
rather say so than let the table above imply a screen exists.

This matters for the feature: the stock delta logic's hardest and most valuable behaviour
(12 → 8 freeing 4) is currently **unreachable by the owner**. It is correct and waiting. Worth
deciding whether a sale-edit UI belongs in Phase 8, or whether the PATCH route should be treated
as dormant like the receivables code.

---

## 5. Test data

Everything hung off one `ZZ_TEST_Stock Shop` customer; cleanup deleted strictly by that id.

Real products I moved during testing, all restored:

| Product | Touched | Restored |
|---|---|---|
| Coke Cola 1.5L | 100 → 20 → 8 → 40 → 25 → 40 → 44 → 39 → 44 → 5 → 4 | **100** |
| Pepsi 1L | 100 → 95 → 100 | **100** |
| Buns | 100 → 90 → 100 (by the delete path itself) | **100** |

Final state verified: **27 products, all at `stock = 100`, none off it**; 0 `ZZ_TEST` leftovers;
1 customer / 1 farmer; 0 beverage / 1 bakery / 1 milk sale; Saif's Rs. 5,000 intact; Big Apple
0.5L still the only priced product.

---

## 6. Checks

| | |
|---|---|
| `tsc --noEmit` | clean |
| `next lint` | clean |
| Production build | green |
| Edge bundle guardrail | **0 matches**, 240 KB production artifact |

---

## 7. Still open

1. **No sale-edit UI** (§4) — the biggest one.
2. **`Product.discountPercent` column drop** — still queued, and now genuinely next, since stock
   is done. Six files read it plus `SALE_DETAIL_SELECT`'s join; `ProductDialog`'s entry point is
   already closed. The catalog's **Discount column now shows "—" on all 27 rows** and should go
   with it.
3. **Context7** — Phase 8 diagnosis item, unchanged.

---

### Source used

**Context7: attempted, still not connecting — 8th consecutive session.** Installed-source
fallback per the CLAUDE.md rule, stated as that rule requires:

- Migration SQL **generated by the installed Prisma 6 CLI**, twice, once against the live
  datasource.
- The `Product` column list was read from the live `information_schema`, not inferred.
- `updateMany` + `increment` semantics and `Prisma.TransactionClient` typing came from the
  generated client in `node_modules/.prisma`, which is what `tsc` checked against.
