# S8 — Multi-unit products (eggs by dozen/tray/peti, beverages by pet)

**Date:** 2026-08-18
**Status:** ✅ shipped — Migration F applied, 13/13 server tests, browser-verified end to end
**Closes:** CHECKLIST #19. Also fixes a silent regression in #17 (cooling charge).

---

## What the owner asked for, and what it now does

His two answers were the whole specification:

> "The eggs stocks must be in single eggs like 1000 eggs or whatever, when dozen sales (reduce stock
> by 12), tray sales (reduce stock by 30), when peti sales (reduce stocks by 360)."

> *(and the full brand × size × bottles-per-pet matrix)*

Both are implemented literally.

| The rule | Where it lives |
|---|---|
| Stock is ONE pool, counted in **base units** | `computeStockDeltas` multiplies `quantity × unitFactor` — `lib/sales.ts` |
| A pack says only how many base units it takes | `ProductUnit.baseFactor` |
| A pack has its own price | `ProductUnit.price` — a peti is not 360 × the egg price |
| What was sold is never re-derived | `SaleItem.unitName` + `SaleItem.unitFactor`, snapshotted |

**Verified in the browser:** 2 dozen of eggs took stock from **100 → 76** (24 eggs, one pool);
editing that bill to 1 dozen put **12 back** (76 → 88); deleting it restored the rest (88 → 100).

---

## The pieces

### Migration F (applied, additive, no data moved)

```sql
CREATE TABLE "ProductUnit" (…);                       -- + unique (productId, name), + FK cascade
ALTER TABLE "ProductUnit" ENABLE ROW LEVEL SECURITY;  -- the project rule for every new table
ALTER TABLE "SaleItem" ADD COLUMN "unitName" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "unitFactor" DECIMAL(10,2) NOT NULL DEFAULT 1;
```

`unitFactor` defaults to **1**, so every line that existed before this migration means exactly what it
always meant. RLS is 19/19 with zero policies, as designed.

### The server

- **The client sends the unit's NAME. The factor never leaves the server.** A `unitFactor` in a request
  body is a **400** (`.strict()`). A wrong factor is the one value that could silently drain a pool.
- An unknown unit name is a **400 that lists the product's real units**.
- **A shortfall is reported in base units** — *"100 in stock but this sale needs 360"* — because the
  pool is eggs. Reporting it in peti would give the owner a number he cannot check against his shelf.
- `DELETE` and `PATCH` restore and reconcile in base units too: 2 peti → 1 frees exactly 360.

### The catalog

Each product gets a **Selling units** editor (unit · contains · price), and the row now reads
`dozen = 12 eggs · tray = 30 eggs · peti = 360 eggs` without opening anything.

### The till

A **"Sold as"** picker sits directly under Product — because choosing a unit rewrites the price
below it — and re-labels the fields: `Quantity (peti)`, `Price per peti`, `1 peti · Line total`.

### The receipt

```
Eggs
  2 dozen × 200.00            Rs. 400.00
--------------------------------
TOTAL                         Rs. 400.00
```

It multiplies out, stays inside 32 columns, and prints the pack name **verbatim, unpluralised** —
"2 peti", not "2 petis". These are the owner's own words for a pack; English pluralisation is not
ours to apply to them.

### The seed — his matrix, as given

**47 new beverage products at price 0** now carry their pets: Sprite, Dew, 7Up, Mirinda, Sting,
Fruitien Joy, Mojo, Local Quarter, Gourmet Cola/Lemon, plus the 250ml / 350ml / 2L sizes of Pepsi and
Coke Cola. Existing rows kept their ids and prices and simply gained a pet.

**🔴 A pet is 12 bottles here, not 24** — every reference table online says 24. And it is **per brand
and per size**, which is why it is stored per product. **Gourmet 1.5L has two pets, 4 and 6**
(`pet 4` / `pet 6`); that is real, not a conflict.

> **For the owner at handover:** price what you stock and deactivate the rest, the same sitting as
> stock counts and shop details. The four flavourless `Gourmet <size>` rows were left untouched.

`prod_eggs.unit` changed **`cotton` → `egg`** — required by his rule, done as a guarded one-row update
that refuses if the product has any sale history. It had none.

---

## 🔴 Three real bugs this found — all invisible to every automated check

All three are the same shape: **a request payload built field by field, which silently drops whatever
the list was never told about.** The request succeeds, the toast is cheerful, and the value is gone.

| Where | Dropped | Consequence |
|---|---|---|
| Till create payload | `unitName` | **A peti saved as ONE egg at Rs. 7,000** — 1 off the pool instead of 360 |
| Till create payload | `chilled` | **The cooling charge (#17) was unreachable from the till** — every bill saved unchilled |
| Catalog edit dialog | `coolingCharge`, `units` | "Product updated", nothing changed. A charge or a pet could only be set at CREATE |

**`tsc`, `next lint`, `npm run build` and the API tests were all green through every one of them** —
the fields are optional, and the tests hand the endpoint a correct body themselves. They were found by
using the screens and reading the rows back out of the database. This is the "verify UI in a real
browser, not on a build" rule earning its keep again; it is now written up as **Gotcha 3c** in
CLAUDE.md, and all three sites carry a 🔴 comment.

Two smaller ones, same session:

- **`PRODUCT_SIZES` and `PRODUCT_UNITS` are zod enums**, so the new sizes (200ml/250ml/300ml/350ml/2L)
  and units (`egg`, and **`litre`, missing since 2026-08-13**) could not be saved from the edit dialog.
  Opening the milk product and saving would have dropped its unit. Both widened.
- A `Map` iterator spread in the seed failed `tsc` under this project's target — `Array.from` instead.

**Cooling verified after the fix:** 2 × (100 + 30) = **Rs. 260**, rate 30 snapshotted on the line.

---

## Database state — clean

| | |
|---|---|
| Products | **75** (28 pre-existing + 47 new) |
| Sub-categories | 20 · **Selling units** 60 |
| Sales | **2** — the real bakery 5,000 and milk 6,000, untouched |
| Customers 1 · Deliveries 1 · BakerySale 1 · MilkSale 1 | untouched |
| 27-product fingerprint | **`b57a51bb57be89cbc9db646d4a2a9972`** — unchanged |
| Products with a cooling charge | **0** (test value reverted) |

Every test sale was deleted and every stock figure verified back to where it started. One product
outside the seed — `Big Apple 0.5L`, created by the owner on 2026-08-07 — was left alone.

**Build:** green. **Guardrails:** no `sqltag` in any client chunk; **0** Prisma/bcrypt hits in the
240KB production middleware bundle.

---

## What is still open

- **S9** — retire the per-module paths, then **Migration B** (drops the 4 old tables). Destructive and
  gated; nothing else in the unified rework is left.
- **Go-live:** #2 data reset, #2b shop details, #3 Vercel/Supabase Pro, #14 region co-location.
- **Phase 8 polish:** #11 PWA manifest, #13 on-device mobile check.

**File:** `docs/responses/2026-08-18-s8-multi-unit-products-shipped.md`
