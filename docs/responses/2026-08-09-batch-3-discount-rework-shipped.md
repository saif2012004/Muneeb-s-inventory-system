# Discount rework — shipped

**Date:** 2026-08-09
**Commit:** `3fedc2a` — *feat: discount is a sale-time percentage, not a product variant* (pushed to `main`)
**Migration:** `20260809000000_add_sale_discount_percent` — applied to the dev database after your go-ahead.

Discount is no longer a catalog row. It is a percentage entered on the bill, at two levels, snapshotted with the sale.

---

## What ran, in the order you specified

| # | Step | Result |
|---|---|---|
| 1 | Schema change | 4 additive fields |
| 2 | `prisma migrate deploy` | applied cleanly |
| 3 | Guarded 36-id delete | 36 deleted, 27 remain, no abort |
| 4 | `seed.ts` update | 62 → 26 seeded products |
| 5 | Post-migration DB verification | all checks pass (§2) |
| 6 | API discount maths | through `reconcileSaleLines`, no parallel path |
| 7 | Sale form + catalog UI | shipped |
| 8 | Browser verification | all cases pass (§4) |

I used `prisma migrate deploy` rather than `migrate dev` deliberately: `deploy` only applies pending
migrations and can never reset, which matters when the target holds Saif's real records.

---

## 1. The delete, and why it could not go wrong quietly

The pre-flight check did not just run *before* the delete — it ran **inside the same transaction**,
as you asked. A single `DO` block with three independent aborts, any of which rolls the whole thing
back:

```sql
IF array_length(variant_ids,1) <> 36 THEN RAISE EXCEPTION ...   -- wrong list
IF bev_refs <> 0 OR bak_refs <> 0  THEN RAISE EXCEPTION ...   -- a sale references a variant
IF deleted <> 36                    THEN RAISE EXCEPTION ...   -- deleted the wrong number
IF remaining <> 27                  THEN RAISE EXCEPTION ...   -- wrong end state
```

It targeted the **36 explicit seeded ids**, never `discountPercent > 0`. Those two predicates matched
the same rows at review time, but only the id list is safe against a product the owner might create
through the catalog in between.

There is also no `ON DELETE CASCADE` from `Product` to the sale-item tables, so even with every guard
removed Postgres would have raised a foreign-key violation rather than silently deleting history.

---

## 2. Post-migration verification (before anything was built on it)

| Check | Result |
|---|---|
| Product count | **27** |
| Variant ids remaining | **0** |
| Big Apple 0.5L (owner-created) | **survives, Rs. 120** |
| `prod_buns` | **survives** |
| Saif's bakery sale resolves | **Buns × 100 = Rs. 5,000** |
| Saif's sale, new bill/line columns | **0.00 / 0.00** — exactly what he was charged |
| Milk (sales / deliveries / purchases) | **1 / 1 / 1**, untouched |
| RLS on the 4 altered tables + Product | **enabled**, `force_rls` still **false** |

The RLS check matters more than it looks: CLAUDE.md warns that `FORCE ROW LEVEL SECURITY` would apply
RLS to the table owner and break Prisma. `ALTER TABLE ... ADD COLUMN` left both flags as they were.

### The seed, proven rather than assumed

`seed.ts` upserts on deterministic ids, so leaving the tier loop in place would have resurrected all
36 variants on the next re-seed. I changed it and then **re-ran the seed** to prove it: *"Seed
complete: 2 categories, 11 sub-categories, 26 products"*, and the database still read 27 rows, 0
variants, with the owner's Rs. 120 price untouched. That is why the seed change and the delete are in
the same commit.

---

## 3. The maths

One implementation, in `lib/sales.ts`, exactly as specified:

```
lineTotal = round(qty × unitPrice × (1 − lineDiscount/100), 2)
subtotal  = Σ lineTotal
total     = round(subtotal × (1 − saleDiscount/100), 2)
```

Rounded at **both** points, on `Prisma.Decimal`, `ROUND_HALF_UP` (verified as the installed default,
not assumed). Order is fixed and is **not commutative** once rounding is involved — line first,
always.

`reconcileSaleLines` carries the discount through; there is no second discount path. One deliberate
asymmetry with the price: **a discount does not re-snapshot when a line's product changes.** The
price re-snapshots because it belongs to the product, but a discount is a decision about the bill, so
swapping the product does not change the deal the owner struck. Send a value to change it, omit it to
keep what was stored.

### A bug the rework created, and I fixed

The header-only `PATCH` branch was commented *"lines untouched, nothing to recompute"*. Once a
whole-bill percentage exists that is false — changing only the percentage moves the total. It now
re-foots from the stored `lineTotal`s (which already carry their own line discounts) and re-checks the
column bound. Left alone, editing a bill discount would have saved the new percentage against the
**old** total.

---

## 4. Browser verification

### Stacking — the exact rupee figures

3 × Rs. 333.00, **7% line**, **5% bill**:

| | Stored |
|---|---|
| `lineTotal` | **929.07** |
| `totalAmount` | **882.62** |
| line % / bill % | 7.00 / 5.00 |

929.07 = 999 × 0.93. 882.62 = 929.07 × 0.95. Line first, then bill on the subtotal.

### Rounding — and a correction to the brief

**The brief's float-drift case doesn't actually drift.** `333 × 0.93` evaluates to exactly `309.69`
in IEEE floats. (`333 × 0.07` *does* drift to `23.310000000000002`, which is why the code uses the
`× (1 − d/100)` multiplier rather than "compute the discount then subtract it".)

So I searched for a case that genuinely breaks, and used it instead:

> **3 × Rs. 12.50 at 33% off**
> float: `25.124999999999996` → rounds to **25.12** — a paisa short, bill doesn't foot
> Decimal: `25.125` → HALF-UP → **25.13**

**Stored: `25.13`.** That is the single most load-bearing number in this verification.

### Snapshot

Moved `prod_coke_cola_1_5l` to **Rs. 999.99** in the catalog, then re-read both sales:

| Stored unit price | Stored line % | Stored line total | Current catalog | Verdict |
|---|---|---|---|---|
| 333.00 | 7.00 | 929.07 | 999.99 | **FROZEN** |
| 12.50 | 33.00 | 25.13 | 999.99 | **FROZEN** |

The detail view renders from the snapshot too — `Coke Cola 1.5L · 1.5L · 7% off · 3 × Rs. 333 →
Rs. 929`, then `Whole-bill discount (5%) −Rs. 46` — while the catalog sat at 999.99. Price restored
to 0.00 afterwards.

### Everything else

| Check | Result |
|---|---|
| Catalog shows no variants | **PASS** — no `% off` anywhere |
| Picker reads sensibly | **PASS** — 17 beverage products, 0 variant rows |
| Saif's bakery sale | **PASS** — Buns 100 × Rs. 50 = Rs. 5,000, no discount shown (0% correctly hidden) |
| Milk unaffected | **PASS** — no discount UI, Rs. 6,000 sale intact |
| `tsc` / `next lint` | clean |
| Production build | green |
| Edge bundle guardrail | **0 matches**, 240 KB production artifact |

---

## 5. Found in browser testing: the bill discount leaked between sales

Recording a 5%-off bill and tapping **"Add another"** carried the 5% into the next sale. The customer
and date persist by design (the common case is another sale to the same shop) and the discount was
riding along with them.

That is money given away with nobody typing anything, and it is invisible — the next bill just comes
out slightly low. It surfaced because the drift-case sale I recorded second came back as `23.87`
rather than `25.13`, and the 5% had no business being there.

Now cleared alongside the lines and the notes. A per-line discount goes with the line that was just
cleared; this is the same thing at bill level.

*This is the third batch running where the browser found something `tsc`, lint and the build all
passed.*

---

## 6. Test data

Everything hung off one `ZZ_TEST_Discount Shop` customer; cleanup deleted strictly by that id. The
one **real** thing I touched was `prod_coke_cola_1_5l`'s price, changed to 999.99 for the snapshot
test and restored to **0.00**.

Final state, verified:

| | |
|---|---|
| Products | **27**, 0 variants |
| Products with a non-zero price | **Big Apple 0.5L = 120.00** only — the pre-test state |
| `prod_coke_cola_1_5l` | **0.00**, restored |
| ZZ_TEST leftovers | **0** |
| Customer / Farmer | 1 / 1 (Saif) |
| Beverage / Bakery / Milk sales | 0 / 1 / 1 |
| Saif's bakery sale | Rs. 5,000 |
| MilkDelivery / FarmerPurchase | 1 / 1 |

---

## 7. Still open

1. **`Product.discountPercent` is still on the table**, as you confirmed — dropped in a separate
   later migration. Its UI entry point is already gone from `ProductDialog`, so no new variant can be
   created in the meantime. Six files still read the column: `ProductTable`, `sale-catalog`,
   `catalog-display`, `validations/catalog`, and the two product API routes.
2. **`SALE_DETAIL_SELECT` still joins `product.discountPercent`** even though the UI now reads the
   line's own value. Harmless, and it goes with the column drop.
3. **Stock is still deferred** — it comes after this, and with variants gone it is now what you said
   it would be: one plain integer per product, no `StockItem` table, no shared-stock plumbing.

**Not done, deliberately:** the cross-category question (a sale stays single-module) is untouched,
pending the client answer.

---

### Context7

Attempted again — **still not connecting, 6th consecutive session**. Fell back to source per the
updated CLAUDE.md rule. Worth noting how much that mattered here rather than being a formality: the
migration SQL was generated by the installed Prisma 6 CLI via `migrate diff` rather than written from
memory, and `Prisma.Decimal`'s rounding mode was confirmed by executing it (`rounding: 4`,
`ROUND_HALF_UP`) rather than assumed — the entire correctness argument for `25.13` rests on that
default being what I thought it was.
