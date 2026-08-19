# S3 — Unified `POST /api/sales`: recon + design. **DO NOT IMPLEMENT.**

**Date:** 2026-08-12
**Code changes: ZERO.** Read-only. No edits, migrations, data writes or installs.
**HEAD `9b87dc4`** ✅ · tracked modifications **0** · deletions **0** (9 untracked response docs).

> ## 🔴 TWO BLOCKERS FOUND. S3 CANNOT BE IMPLEMENTED AS SPECIFIED WITHOUT THEM.
>
> **1. `Product.stock` is `Int`.** "Milk decrements like any product" is impossible for fractional
> litres — you cannot decrement an integer column by 12.5. **Needs a Migration D** (widen to
> `Decimal`), exactly as `SaleItem.quantity` needed Migration C.
>
> **2. The `quantity` validator is `.int()`.** It rejects `12.5` before any of this runs.
>
> Neither is a money-helper change, so nothing needs forking. Both are additive. Details in §1.5–1.6.

---

## STEP 1 — Recon

### 1.1 The current sale-write path, end to end

`app/api/beverages/sales/route.ts` `POST`, in order:

| # | Step | Line | Queries |
|---|---|---|---|
| 1 | `requireOwner()` | :123 | **0** — JWT session, no DB adapter |
| 2 | `saleCreateSchema.safeParse` | :127 | 0 |
| 3 | `resolveModuleCategoryId("beverages")` | :131 | **1–2** (`findUnique` on seed id, else `findFirst` by name) |
| 4 | `prisma.customer.findUnique` | :141 | **1** — "checked up front so a bad id surfaces as a sentence rather than a raw FK violation" |
| 5 | `loadSaleProducts(…)` → `prisma.product.findMany` w/ `SALE_PRODUCT_SELECT` | :147 | **1** |
| 6 | Build `lines[]`: `snapshotUnitPrice` → `computeLineTotal` | :161–174 | **0 — pure** |
| 7 | `computeSaleTotal(lines, billDiscount)` | :178 | 0 |
| 8 | `checkTotalFits(totalAmount)` | :182 | 0 |
| 9 | `computeStockDeltas([], {creates: lines, …})` | :190 | 0 |
| 10 | `findStockShortfalls(deltas, products)` → `failStockBlocked` | :195–199 | 0 |
| 11 | **`prisma.$transaction(async tx => …)`** | :204 | see below |
| 12 | → `applyStockDeltas(tx, deltas)` | :205 | **N** (one per distinct product) |
| 13 | → `tx.beverageSale.create({ …, select: SALE_DETAIL_SELECT })` | :206 | **~5** |
| 14 | `ok(serialize(sale), 201)` | :217 | 0 |

**Comment at :201 states the ordering rule and it must be preserved:** *"The stock write goes first
so its conditional guard aborts before any sale row exists."*

### 1.2 What is actually inside the transaction — measured, not estimated

`applyStockDeltas` loops **sequentially, one `updateMany` per product**:

```ts
for (const [productId, delta] of Array.from(deltas.entries())) {
  if (delta === 0) continue;
  const result = await tx.product.updateMany({
    where: delta < 0 ? { id: productId, stock: { gte: -delta } } : { id: productId },
    data: { stock: { increment: delta } },
  });
  if (result.count === 0) throw new StockConflictError(productId);
}
```

The conditional `stock: { gte: -delta }` is the oversell guard — a `count === 0` means someone else
took the stock, and it throws to abort the transaction.

**From a real query log I captured during the item-#9 verification**, a ONE-line sale produced
inside the transaction:

```
BEGIN
DEALLOCATE ALL
UPDATE  "Product" SET "stock" = "stock" + $1 WHERE id = $2 AND "stock" >= $3
INSERT  "BeverageSale" (…) RETURNING id
INSERT  "BeverageSaleItem" (…) RETURNING id
SELECT  … FROM "BeverageSale"      WHERE id = $1
SELECT  … FROM "Customer"          WHERE id IN ($1)
SELECT  … FROM "BeverageSaleItem"  WHERE "saleId" IN ($1)
```

**6 statements for a single line** — 1 stock update, 2 inserts, and **3 read-back SELECTs** caused
by `select: SALE_DETAIL_SELECT` (which joins `customer`, `items`, and `items.product`).

### 1.3 🔴 The transaction timeout — the create path is the one that never got raised

| Route | `$transaction` options |
|---|---|
| `app/api/beverages/sales/[id]/route.ts:246` (**edit**) | `timeout: 15_000, maxWait: 5_000` |
| `app/api/bakery/sales/[id]/route.ts:236` (**edit**) | `timeout: 15_000, maxWait: 5_000` |
| `app/api/milk/deliveries/quick-entry/route.ts:292` | `timeout: 25_000, maxWait: 15_000` |
| **`app/api/beverages/sales/route.ts:204` (create)** | **none — Prisma defaults: `timeout` 5s, `maxWait` 2s** |
| **`app/api/bakery/sales/route.ts` (create)** | **none — defaults** |

**So raising it is already this codebase's established answer; the create path simply never got it.**

**Does a mixed bill risk exceeding the default? Yes — comfortably.** At the documented ~1.1 s/query
floor (function in `iad1`, database in `ap-northeast-2`):

| Bill | Statements in tx | Est. time | vs 5s default |
|---|---|---|---|
| 1 line (today) | 6 | ~6.6 s | **already over** — and it *has* failed: `Transaction already closed … 5359 ms passed` |
| 3 lines, mixed | 3 UPDATE + 2 INSERT + 3 SELECT = **8** | ~8.8 s | **far over** |
| 5 lines, mixed | 5 + 2 + 3 = **10** | ~11 s | **far over** |

This is not theoretical — the single-line create has already rolled back in practice on a slow day.
**Design response in §2.5: raise the timeout *and* move the read-back out.**

### 1.4 The money helpers — quoted, to be reused verbatim

```ts
export function computeLineTotal(
  unitPrice: Prisma.Decimal,
  quantity: number,
  discountPercent: Prisma.Decimal = new Prisma.Decimal(0)
): Prisma.Decimal {
  return roundMoney(unitPrice.mul(quantity).mul(discountMultiplier(discountPercent)));
}

export function computeSaleTotal(
  lines: { lineTotal: Prisma.Decimal }[],
  saleDiscountPercent: Prisma.Decimal
): { subtotal: Prisma.Decimal; total: Prisma.Decimal } {
  const subtotal = sumLineTotals(lines);
  return { subtotal, total: applySaleDiscount(subtotal, saleDiscountPercent) };
}

export function snapshotUnitPrice(
  product: SaleProduct,
  override: number | undefined
): Prisma.Decimal {
  return override === undefined ? product.price : new Prisma.Decimal(override);
}
```

**✅ None needs modification.** `computeLineTotal`'s `quantity: number` accepts `12.5` and
`Decimal.mul(12.5)` is exact, so decimal litres flow through the existing arithmetic untouched.
`discountPercent` already defaults to zero, so a no-discount bill is the *default* path, not a
special case. `computeSaleTotal(lines, new Prisma.Decimal(0))` returns `total === subtotal`.

Also reused unchanged: `roundMoney`, `checkTotalFits`, `MAX_MONEY`, `loadSaleProducts`,
`SALE_PRODUCT_SELECT`, `SALE_DETAIL_SELECT`, `computeStockDeltas`, `findStockShortfalls`,
`stockBlockMessage`, `applyStockDeltas`, `StockConflictError`, `isSaleProblem`, `SaleLine`.

`reconcileSaleLines` is **not** used by a create — it is the edit-path diff. It comes in at S4/S8 with
the edit UI.

### 1.5 🔴 BLOCKER 1 — `Product.stock` is `Int`

```prisma
/// Units on hand. TEMPORARY seed value of 100 — the owner sets real numbers
/// via the catalog stock editor. Beverages + bakery only; milk has no products.
stock           Int         @default(100)          // prisma/schema.prisma:45
```

`applyStockDeltas` issues `data: { stock: { increment: delta } }`. For a 12.5 L milk line
`delta = -12.5`, and **an `Int` column cannot take that.**

**Migration D is required before S3 can satisfy "milk decrements like any product":**

```sql
ALTER TABLE "Product" ALTER COLUMN "stock" SET DATA TYPE DECIMAL(10,2);
```

Same shape as Migration C — additive, widening, lossless for existing whole numbers, and Prisma will
surface `number → Decimal` at compile time. **It is its own gated step; I have not written it.**

*(Two doc lines go stale with it: `schema.prisma:44` "milk has no products" and `:151` "Milk is NOT
here — it has no products, no stock". Fix in the same commit.)*

### 1.6 🔴 BLOCKER 2 — the `quantity` validator rejects decimals

```ts
// lib/validations/sales.ts:32
const quantity = z
  .number({ message: "Quantity must be a number" })
  .int({ message: "Quantity must be a whole number" })   // ← rejects 12.5
  .min(1, { message: "Quantity must be at least 1" })
  .max(1_000_000, { message: "Quantity is too large" });
```

**Do NOT relax this shared validator** — beverages and bakery sell bottles and pieces, and "2.5
bottles" should stay an error. The unified endpoint needs its **own** schema with a decimal-capable
quantity, added alongside. §2.2.

### 1.7 Milk-as-a-product does not exist yet

Queried live for any milk category, sub-category or product:

```sql
… WHERE lower(c.name) LIKE '%milk%' OR lower(s.name) LIKE '%milk%' OR lower(p.name) LIKE '%milk%';
→ []   (no rows)
```

**Nothing exists.** Only Bakery (10 products) and Beverages (17). And the module map has no milk key:

```ts
// lib/modules.ts:22
export const MODULE_CATEGORIES = {
  beverages: { seedId: "cat_beverages", name: "Beverages" },
  bakery:    { seedId: "cat_bakery",    name: "Bakery" },
} as const;
```

**Creating the milk Category + Product is a later step** (data, plus a `MODULE_CATEGORIES` entry).
The S3 design must work once it exists and must not assume it does — see §2.3, where module
resolution is done from the product's own category rather than a hardcoded map.

---

## STEP 2 — The design

### 2.1 Contract

```
POST /api/sales        runtime = "nodejs"
```

```jsonc
{
  "customerId": "cus_…",
  "saleDate":   "2026-08-12T10:00:00.000Z",
  "notes":      "optional, ≤500 chars, nullable",
  "items": [
    { "productId": "prod_pepsi_1_5l", "quantity": 3,    "unitPrice": 275.50 },
    { "productId": "prod_buns",       "quantity": 10               },
    { "productId": "prod_milk",       "quantity": 12.5, "unitPrice": 118 }
  ]
}
```

- **No `discountPercent` anywhere** — not on the bill, not on a line. Not accepted, not written; the
  columns keep their `0` defaults.
- `unitPrice` is an **optional create-time override**, exactly as today (the seed ships products at
  price 0). Server-authoritative on update — but there is no update here; S3 is create-only.
- `totalAmount` and `lineTotal` are **never accepted from the client**.

**Success — `201`:**

```jsonc
{ "data": { "id": "…", "saleDate": "…", "totalAmount": 4331.50, "notes": null,
            "customer": { … },
            "items": [ { "id":"…", "productId":"…", "moduleKey":"beverages",
                         "quantity": 3, "unitPrice": 275.50,
                         "lineTotal": 826.50, "netLineTotal": 826.50,
                         "product": { "name": "Pepsi 1.5L", … } } ] },
  "error": null }
```

**Errors** reuse the existing shapes: `400` validation, `404` missing customer/product, `409`
stock shortfall with the structured `blockedBy` list, `409` product from an unknown category.

### 2.2 Validation — additive, old schema untouched

New in `lib/validations/sales.ts`, sitting beside the existing ones:

```ts
// Decimal-capable: milk sells by the litre. The existing `quantity` keeps its
// .int() for the per-module routes, where 2.5 bottles is a real error.
const decimalQuantity = z.number()
  .positive({ message: "Quantity must be more than zero" })
  .max(1_000_000, { message: "Quantity is too large" })
  .multipleOf(0.01, { message: "Quantity can have at most 2 decimal places" });

export const unifiedSaleItemSchema = z.object({
  productId: id,
  quantity: decimalQuantity,
  unitPrice: money.optional(),   // create-only override
  // NO discountPercent
});

export const unifiedSaleCreateSchema = z.object({
  customerId: id,
  saleDate,
  notes,
  items: z.array(unifiedSaleItemSchema).min(1).max(100),
  // NO discountPercent
});
```

`multipleOf(0.01)` matches `Decimal(10,2)`, so a value the column cannot store is rejected with a
sentence rather than being silently rounded.

### 2.3 Module resolution — derived once, then snapshotted

`moduleKey` is a **snapshot of what the line was sold as** (schema doc), so it is resolved at write
time from the product's own category and then frozen:

1. One query fetches all three module category ids (or `Category.name` comes back with the product).
2. Each line's `moduleKey` = the category its product belongs to, lower-cased
   (`"beverages" | "bakery" | "milk"`).
3. A product whose category is none of the three → **409**, "That product isn't in a category this
   till can sell from."

This deliberately **does not** use `MODULE_CATEGORIES`'s hardcoded map for validation, so it keeps
working when the milk category is added, and it removes the per-module `loadSaleProducts` rejection
that currently blocks mixed baskets.

### 2.4 Money — reused verbatim, no new arithmetic

```ts
const lines: SaleLine[] = items.map((item) => {
  const product  = products.get(item.productId)!;
  const unitPrice = snapshotUnitPrice(product, item.unitPrice);   // reused
  return {
    productId: item.productId,
    quantity:  item.quantity,                                     // may be 12.5
    unitPrice,
    discountPercent: ZERO,                                        // always 0
    lineTotal: computeLineTotal(unitPrice, item.quantity),        // reused, default 0 discount
  };
});

const { total: totalAmount } = computeSaleTotal(lines, ZERO);     // reused → total === subtotal
const tooLarge = checkTotalFits(totalAmount);                     // reused
```

**`netLineTotal === lineTotal` for every line**, because there is no bill discount to apportion.
Written explicitly rather than left to a default, so the invariant is visible at the write site.

> **This deletes the biggest risk from the original estimate.** `netLineTotal` exists to spread a
> bill discount pro-rata with residue-to-largest-line; with no discounts that logic is the identity
> function and never needs writing. Old Risk R1 is gone.

### 2.5 The transaction — how it stays inside the timeout

Two changes from the per-module create, both justified by §1.2–1.3:

**(a) Move the read-back OUT.** Create with a minimal select inside the transaction, then fetch the
detail outside it. That removes **3 SELECTs** from the critical section.

**(b) Pass explicit options**, matching the precedent the edit routes already set.

```ts
// OUTSIDE: validation, customer check, product load, all money math,
//          computeStockDeltas, findStockShortfalls  → shortfall returns 409 here,
//          before a transaction is even opened.

const { id } = await prisma.$transaction(async (tx) => {
  await applyStockDeltas(tx, stockDeltas);          // N conditional UPDATEs — guard first
  return tx.sale.create({
    data: { customerId, saleDate, notes: notes ?? null,
            discountPercent: 0, totalAmount,
            items: { create: lines.map(l => ({ ...l, moduleKey: l.moduleKey,
                                               netLineTotal: l.lineTotal })) } },
    select: { id: true },                            // ← minimal, not SALE_DETAIL_SELECT
  });
}, { timeout: 15_000, maxWait: 5_000 });             // ← the edit routes' values

// OUTSIDE: the detail read for the response
const sale = await prisma.sale.findUnique({ where: { id }, select: SALE_DETAIL_SELECT });
```

**Stock still commits with the sale**, and the ordering comment at `:201` still holds — the stock
write goes first so its conditional guard aborts before any sale row exists.

| | Statements in tx | Est. at 1.1 s | vs 15 s |
|---|---|---|---|
| 3-line mixed bill | 3 UPDATE + 2 INSERT = **5** | ~5.5 s | comfortable |
| 5-line mixed bill | 5 + 2 = **7** | ~7.7 s | comfortable |
| 10-line bill | 10 + 2 = **12** | ~13 s | tight — see below |

**Honest limit:** beyond ~10 distinct products this gets tight again, because `applyStockDeltas` is
one round trip per product by construction. If real bills get that long, the fix is to batch the
stock guard into a single statement — **not** in S3, but worth knowing the ceiling.

### 2.6 All-or-nothing on shortfall

Two independent layers, both already built:

1. **Pre-check, outside the transaction.** `findStockShortfalls` compares deltas against the loaded
   stock and returns `409` with the structured `blockedBy: [{ id, name, shortfall }]` via
   `failStockBlocked` — so the common case never opens a transaction at all.
2. **Race guard, inside.** `applyStockDeltas`'s `where: { stock: { gte: -delta } }` returns
   `count === 0` if stock moved between check and write, throwing `StockConflictError` and rolling
   the whole thing back.

**A shortfall on ANY line blocks the ENTIRE bill** — no partial sale, no negative stock. That is the
existing semantics; the unified route inherits it unchanged.

### 2.7 Milk lines

Once the milk Product exists, a milk line is **an ordinary line**:

| | |
|---|---|
| `productId` | the real milk product — **not null** |
| `moduleKey` | `"milk"`, resolved from its category |
| `quantity` | decimal litres, e.g. `12.5` |
| `unitPrice` | the catalog rate, overridable at billing |
| `lineTotal` | `computeLineTotal(rate, litres)` — the same helper |
| stock | decremented like any product — **needs Migration D (§1.5)** |

No branch, no special case in the write path. **Milk stock replenishment from farmer deliveries is
a separate later step and is not designed here** — this endpoint only decrements on sale.

### 2.8 Nothing is removed

`/api/beverages/sales`, `/api/bakery/sales`, `/api/milk/sales` and their screens all stay live and
untouched. No reporting repoint (S6), no receipt work, no farmer code.

---

## STEP 3 — Test plan for the implementation turn

Everything `ZZ_TEST_`-scoped and cleaned up; the 2 real sales, Saif and all farmer data untouched.

**Pre-flight:** record the product fingerprint, the stock of each product about to be sold, and the
farmer net owed (Rs. 5,000) — to reconcile after.

| # | Test | Expected |
|---|---|---|
| 1 | **Mixed bill reconciles to the paise.** 3 × Pepsi @ 275.50 + 10 × Buns @ 50 + 12.5 L milk @ 118 | lines `826.50`, `500.00`, `1475.00`; `totalAmount` **`2801.50`**; every `netLineTotal === lineTotal` |
| 2 | **`Σ netLineTotal === totalAmount`** | exact, in SQL not just the response |
| 3 | **`moduleKey` per line** | `beverages`, `bakery`, `milk` — one bill, three modules |
| 4 | **Stock across all three** | each product down by exactly its quantity; **milk down 12.5**, verified as `Decimal` |
| 5 | **Decimal quantity persists** | `SaleItem.quantity = 12.50` |
| 6 | **Price override honoured on create** | a 0-priced product billed at a real price |
| 7 | **All-or-nothing shortfall** | order more than stock on ONE line → `409` with `blockedBy`; **no `Sale` row created, no stock moved on any line** |
| 8 | **Unknown-category product** | `409`, no write |
| 9 | **Discount fields rejected/ignored** | sending `discountPercent` does not produce a discounted total; stored values stay `0` |
| 10 | **Transaction fits** | measure wall time on the 3-line bill; confirm well under 15 s and no `Transaction already closed` |
| 11 | **Old paths still work** | a beverage sale via `/api/beverages/sales` still gives `743.85 / 706.66`; a milk sale via `/api/milk/sales` still gives its total |
| 12 | **Farmer untouched** | net owed still **Rs. 5,000**, delivery 250 L @ 30,000, purchase 25,000 |

Test 7 is the one that most needs doing properly — it is the difference between a blocked sale and a
half-written one.

---

## What must happen before S3 can be built

| | Item | Nature |
|---|---|---|
| **1** | **Migration D — `Product.stock` `Int` → `Decimal(10,2)`** | Schema. Own gate. Blocks milk stock decrement |
| **2** | **Milk `Category` + `SubCategory` + `Product`, and a `MODULE_CATEGORIES` milk entry** | Data + one small code change. Note `Product.stock` defaults to **100**, meaningless for milk until the owner sets it |
| 3 | `unifiedSaleCreateSchema` (§2.2) | Additive; part of S3 itself |

**1 and 2 are prerequisites, not part of S3.** S3 can be *built and tested* for beverages + bakery
without them, but the milk line — the whole point — needs both.

**Open questions still unanswered** (from the design doc, unchanged): how the owner enters a milk
line (Q3), and whether a mixed receipt needs per-category subtotals (Q1). Neither blocks the API,
both block S4's screen.

---

## Constraint compliance

| Constraint | Status |
|---|---|
| No money-logic reimplementation | ✅ every helper reused verbatim; none needs modification |
| No Sale-path removal, no reporting repoint, no receipt work | ✅ |
| Farmer code untouched | ✅ not read for modification; no farmer table queried |
| No schema changes, migrations, data writes, installs | ✅ **zero writes this turn** |
| 2 real sales + Saif unmodified | ✅ no writes at all |
