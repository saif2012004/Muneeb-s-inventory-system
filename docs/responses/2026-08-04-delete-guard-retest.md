# Response — delete-guard re-test (queued since Phase 2, finally run for real)

**Date:** 4 Aug 2026
**Task:** re-test the catalog delete guard against real sale history — Branch A (409 refusal +
structured payload + deactivate-by-id) and Branch B (product soft-delete) — then clean up.
**Outcome:** **both branches PASS. No failures found.** DB restored to exact baseline.
**No code changes, no commit.** Stopped after report + cleanup.

| | |
|---|---|
| Environment | `npm run dev` + Chrome DevTools, isolated browser context |
| Test login | `zz_test_guard@example.test` — throwaway, **deleted afterwards** |
| Owner account | **`i228767@nu.edu.pk` never touched** |
| Test data | all `ZZ_TEST_`-prefixed, **deleted** |
| Code changed | **none** — `git status` shows only untracked docs |

Also confirmed at the top of this turn: **commit message left as-is**, no amend, no
force-push, per your instruction.

---

## 0. Fixture

One customer and one sale, deliberately spanning **two** sub-categories of different sizes:

| | |
|---|---|
| Customer | `ZZ_TEST_Guard Hotel` (shop) |
| Sale | `Rs. 1,140`, 04/08/2026, notes `ZZ_TEST_ delete-guard fixture` |
| Line 1 | **Big Apple** — 4 × Rs. 90 = Rs. 360 · sub-category has **1** product |
| Line 2 | **Pepsi 1.5L** — 6 × Rs. 130 = Rs. 780 · sub-category has **16** products |

**Why the second line matters.** The brief suggested Big Apple, but its sub-category holds
exactly one product — so "only the named product is deactivated, siblings untouched" would be
vacuously true. Selling a Pepsi item too means the Pepsi sub-category has 15 innocent siblings
that must survive. That is the only way the by-id claim is actually tested.

---

## 1. Branch A — refusal is a 409 with a structured payload

### 1.1 Sub-category delete → REFUSED

`/catalog` → Big Apple sub-category → Actions → Delete sub-category → confirm.

**Wire response — `DELETE /api/subcategories/sub_big_apple` → `409`:**

```json
{"data":null,
 "error":"Can't delete \"Big Apple\" — 1 product has sales recorded against it (Big Apple). Deactivate those products instead so past sales stay intact.",
 "blockedBy":[{"id":"prod_big_apple","name":"Big Apple","saleCount":1}]}
```

**UI:**

| Check | Result |
|---|---|
| Dialog stays open, nothing deleted | ✅ |
| Amber (not rose) refusal panel | ✅ `"This can't be deleted"` |
| Server message shown **verbatim** | ✅ |
| `blockedBy` rendered as a **field** | ✅ `"Big Apple — 1 sale"` (name + saleCount) |
| Destructive button removed after refusal | ✅ |
| `Deactivate these` offered | ✅ |

### 1.2 Whole-category delete → REFUSED, naming both

`DELETE /api/categories/cat_beverages` → **409**:

```json
{"data":null,
 "error":"Can't delete \"Beverages\" — 2 products have sales recorded against it (Big Apple, Pepsi 1.5L). Deactivate those products instead so past sales stay intact.",
 "blockedBy":[{"id":"prod_big_apple","name":"Big Apple","saleCount":1},
              {"id":"prod_pepsi_1_5l","name":"Pepsi 1.5L","saleCount":1}]}
```

UI listed both from the structured payload — `Big Apple — 1 sale`, `Pepsi 1.5L — 1 sale` —
with the caveat *"Deactivating retires these products from new sales. It does not make this
deletable — the sales history is kept either way."*

**The `blockedBy` field is genuinely consumed, not the prose.** Proof: the message abbreviates
to "(Big Apple, Pepsi 1.5L)", while the rendered list carries a **per-product sale count** that
appears nowhere in the sentence. That number can only come from the structured field.

### 1.3 "Deactivate these" → PATCHes BY ID, siblings untouched

Network — exactly two requests, each addressed by the **id** from `blockedBy`:

```
PATCH /api/products/prod_big_apple    [200]
PATCH /api/products/prod_pepsi_1_5l   [200]
```

Before → after:

| Measure | Before | After |
|---|---|---|
| Inactive products | `[]` | `["Big Apple", "Pepsi 1.5L"]` |
| Pepsi sub-category active | 16 | **15** |
| Pepsi sub-category inactive | — | `["Pepsi 1.5L"]` only |
| Products in other sub-categories deactivated | — | **none** |
| Total products | 62 | **62** (nothing deleted) |

**Exactly the two named products, and only those.** The other 15 Pepsi products — including
`Pepsi 1.5L (20% off)`, `(30% off)`, `(60% off)`, and every other size — stayed active.

### 1.4 Nothing was lost

| Check | Result |
|---|---|
| Beverages category still exists | ✅ |
| Big Apple sub-category still exists | ✅ |
| Categories / sub-categories | 2 / 11 — unchanged |
| Products | 62 — unchanged |
| Sale | 1 sale, 2 items, total `1140.00` |
| Price snapshots | `90.00, 130.00` — untouched |

**Branch A: PASS.**

---

## 2. Branch B — deleting the product is a SOFT delete, not a 409

Reactivated Big Apple first so the `true → false` transition was observable, then deleted the
**product** itself from `/catalog`.

Dialog wording was already honest about the outcome: *"If "Big Apple" has sales recorded, it
will be deactivated instead of deleted so past sales stay intact."*

**Wire response — `DELETE /api/products/prod_big_apple` → `200` (not 409):**

```json
{"data":{"deleted":"soft",
         "product":{"id":"prod_big_apple","name":"Big Apple","isActive":false, …},
         "message":"\"Big Apple\" has sales recorded against it, so it was deactivated instead of deleted. Past sales are unchanged."},
 "error":null}
```

| Check | Result |
|---|---|
| Status | **200**, not 409 ✅ |
| `deleted` | **`"soft"`** ✅ |
| `isActive` | **`false`** ✅ |
| Row retained (not removed) | ✅ product object returned |
| Toast reports what actually happened | ✅ message shown verbatim |

### 2.1 History still reads correctly

Expanded the sale row on `/beverages` with both products now inactive:

```
ZZ_TEST_Guard Hotel   04/08/2026 · 2 items · Shop        Rs. 1,140
  Big Apple  (inactive)      4 × Rs. 90                    Rs. 360
  Pepsi 1.5L (inactive)      1.5L · 6 × Rs. 130            Rs. 780
  Notes: ZZ_TEST_ delete-guard fixture
```

- Product **names still resolve** — the soft delete kept the row, so nothing renders as a
  dangling id.
- Both correctly marked **(inactive)**.
- Prices are the **stored snapshots** (Rs. 90, Rs. 130) — the catalog price is 0 for both.
- Sale total unchanged at Rs. 1,140.

**Branch B: PASS.** This is exactly why the guard soft-deletes rather than refusing: the
product row is what makes a past sale readable.

---

## 3. Failures

**None.** Both branches behaved exactly as designed. Nothing was fixed or hidden — there was
nothing to fix.

### Minor observations (not failures, no action taken)

1. **Dev-mode latency on multi-step actions.** "Deactivate these" issues its PATCHes
   sequentially and each triggers a catalog refetch, so the dialog stayed open ~10s in
   `next dev`. It completed correctly and the dialog closed. Production compiles ahead of
   time; not worth changing.
2. **Success toasts are easy to miss when polling.** The soft-delete toast landed at ~10.5s
   and the deactivate toast expired between two of my reads. Purely an artifact of automated
   observation — a person watching the screen sees them.
3. The product row menu is labelled `Edit / Deactivate / Delete` (not "Delete product"), which
   the dialog title then expands to "Delete product?". Consistent enough; noting only because
   the brief's wording differed.

---

## 4. Cleanup — DB restored to exact baseline

| Table | Baseline | After cleanup | Match |
|---|---|---|---|
| `User` | 1 | 1 (`i228767@nu.edu.pk`) | ✅ |
| `Customer` | 0 | 0 | ✅ |
| `BeverageSale` | 0 | 0 | ✅ |
| `BeverageSaleItem` | 0 | 0 | ✅ |
| `Product` | 62 | 62 | ✅ |
| `Product` active | 62 | **62** | ✅ |
| `Product` with price ≠ 0 | 0 | 0 | ✅ |
| `Category` / `SubCategory` | 2 / 11 | 2 / 11 | ✅ |
| `BakerySale` / `CustomerPayment` | 0 / 0 | 0 / 0 | ✅ |

Deleted, `ZZ_TEST_`-scoped only: 2 sale items, 1 sale, 1 customer, 1 throwaway user.
**Reactivated both products** I deactivated during the test (Big Apple, Pepsi 1.5L) — all 62
are active again. Verified **0 non-`ZZ_TEST_` customers and 0 non-`ZZ_TEST_` sales** existed
before deleting, so nothing of yours was ever in range.

Dev server stopped. `git status` shows **no source changes** — only the untracked
`docs/prompt.txt` and this `docs/responses/` folder.

---

## 5. What this closes

The delete-guard 409 path has been **outstanding since Phase 2**, where it could only ever be
exercised against a test fixture because no real sale history existed. It is now verified
end-to-end against real rows, in the browser, at all three levels:

| Level | Behaviour | Verified |
|---|---|---|
| Category | 409 + `blockedBy` | ✅ |
| Sub-category | 409 + `blockedBy` | ✅ |
| Product | 200 + soft delete | ✅ |

Nothing else started — no Phase 4.
