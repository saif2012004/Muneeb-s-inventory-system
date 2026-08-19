# S3 — unified `POST /api/sales`: re-grounding + final design

**Date:** 2026-08-12
**HEAD:** `8847fff` · tree clean (untracked docs only) · **9 migrations, "Database schema is up to date!"**
**This turn:** read-only. **Zero code edits, zero migrations, zero DB writes.** Design only.
**Scope:** beverages + bakery live; milk designed-for but dormant.

---

# STEP 0 — Re-grounding (verified against current code, not the prior recon)

### ✅ Migration D landed — `Product.stock` is `numeric(10,2)`

```
Product.stock            numeric(10,2)
SaleItem.quantity        numeric(10,2)
SaleItem.lineTotal       numeric(10,2)
SaleItem.netLineTotal    numeric(10,2)
SaleItem.discountPercent numeric(5,2)
Sale.discountPercent     numeric(5,2)
Sale.totalAmount         numeric(10,2)
```

### ✅ `loadSaleProducts` normalises stock via `toSaleProduct`

`lib/sales.ts`:

```ts
export type SaleProductRow = Omit<SaleProduct, "stock"> & {
  stock: Prisma.Decimal | number;
};

function toSaleProduct(row: SaleProductRow): SaleProduct {
  return { ...row, stock: Number(row.stock) };
}

export async function loadSaleProducts(
  productIds: string[],
  options: { categoryId: string; moduleLabel: string;
             findMany: (ids: string[]) => Promise<SaleProductRow[]>; }
): Promise<Map<string, SaleProduct> | SaleProblem> {
  const unique = Array.from(new Set(productIds));
  // Normalise here, once, so every check below and every caller downstream sees
  // a plain `number` stock. See toSaleProduct.
  const products = (await options.findMany(unique)).map(toSaleProduct);
```

### ✅ `failStockBlocked` now serializes

`lib/api.ts`:

```ts
export function failStockBlocked(
  error: string,
  shortBy: { productId: string; name: string;
             available: DecimalLike; requested: DecimalLike; shortfall: DecimalLike; }[]
): NextResponse {
  return NextResponse.json(
    { data: null, error, shortBy: serialize(shortBy) },
    { status: 409 }
  );
}
```

Its comment already names this endpoint as the reason it exists — *"the backstop for the next caller:
the unified /api/sales, which will build shortfalls from its own query."* **This design is that
caller**, and it will reuse `findStockShortfalls`, so the values arriving are already numbers and
`serialize` stays a no-op. The backstop is not load-bearing here either; it is insurance.

### ✅ Money + stock helpers unchanged and reusable verbatim

| Export | Signature |
|---|---|
| `MAX_MONEY` | `Prisma.Decimal` = `99999999.99` |
| `snapshotUnitPrice` | `(product: SaleProduct, override: number \| undefined) => Prisma.Decimal` |
| `roundMoney` | `(value: Prisma.Decimal) => Prisma.Decimal` (`toDecimalPlaces(2)`) |
| `computeLineTotal` | `(unitPrice: Prisma.Decimal, quantity: number, discountPercent?: Prisma.Decimal) => Prisma.Decimal` |
| `applySaleDiscount` | `(subtotal: Prisma.Decimal, discountPercent: Prisma.Decimal) => Prisma.Decimal` |
| `sumLineTotals` | `(lines: { lineTotal: Prisma.Decimal }[]) => Prisma.Decimal` |
| `computeSaleTotal` | `(lines, saleDiscountPercent: Prisma.Decimal) => { subtotal; total }` |
| `checkTotalFits` | `(total: Prisma.Decimal) => SaleProblem \| null` |
| `computeStockDeltas` | `(existing: ExistingSaleLine[], result: { updates; creates; removedIds }) => StockDeltas` |
| `findStockShortfalls` | `(deltas: StockDeltas, products: Map<string, SaleProduct>) => StockShortfall[]` |
| `stockBlockMessage` | `(shortfalls: StockShortfall[]) => string` |
| `applyStockDeltas` | `(tx: Prisma.TransactionClient, deltas: StockDeltas) => Promise<void>` |
| `StockConflictError` | `class … { constructor(readonly productId: string) }` |

**`computeLineTotal` takes `quantity: number`** — which is exactly what a decimal quantity needs, and
requires no change. Verified the precision question by execution rather than assuming:

```
qty 12.5   -> Decimal: 12.5    | 275.50 x qty = 3443.75
qty 0.07   -> Decimal: 0.07    | 275.50 x qty = 19.285
qty 2.35   -> Decimal: 2.35    | 275.50 x qty = 647.425
```

decimal.js constructs from a number's **shortest round-trip decimal form**, so any 2-dp quantity is
exact. ⚠️ But the same check shows the limit:

```
Decimal(0.1 + 0.2)  ->  0.30000000000000004   <- float noise DOES survive a COMPUTED float
```

**Design rule that follows:** pass the **validated quantity straight from the request body** into
`computeLineTotal`. Never a quantity the route derived by arithmetic.

### ✅ The transaction-timeout situation still holds

| Path | Call | Timeout |
|---|---|---|
| `app/api/beverages/sales/route.ts:205` (CREATE) | `prisma.$transaction(async (tx) => {…})` | **none → Prisma 5s default** |
| `app/api/bakery/sales/route.ts:203` (CREATE) | same | **none → 5s** |
| `app/api/beverages/sales/[id]/route.ts:212` (EDIT) | + `{ timeout: 15_000, maxWait: 5_000 }` | 15s |
| `app/api/bakery/sales/[id]/route.ts:200` (EDIT) | + `{ timeout: 15_000, maxWait: 5_000 }` | 15s |

Confirmed, and the create path also does its `SALE_DETAIL_SELECT` read-back **inside** the
transaction — both of the things this design changes.

### 🔎 Three findings the prior recon did not carry

**1. `SALE_DETAIL_SELECT` is missing the two unified columns.** It *works* against `Sale`/`SaleItem`
(every field it names exists there), but it selects **neither `moduleKey` nor `netLineTotal`** —
it was written for the old tables, exactly as CLAUDE.md's warning about its generic name says. The
unified endpoint needs a superset; it cannot just "fetch `SALE_DETAIL_SELECT` after".

**2. `netLineTotal` and `moduleKey` are `NOT NULL` with NO default** — both must be written
explicitly on every line. The two `discountPercent` columns are `NOT NULL DEFAULT 0`, so **omitting
them from the write satisfies "no discount anywhere"** with no explicit zeroes needed.

**3. `loadSaleProducts` cannot be reused as-is** — it takes a single `categoryId` and rejects
anything outside it (`"X is not a Beverages product"`). That single-category rule is the whole point
for the per-module routes and must not be loosened. The unified endpoint needs its own loader.

---

# STEP 1 — The design

## 1. Files

| File | Status | Purpose |
|---|---|---|
| `app/api/sales/route.ts` | **new** | `POST` (and a `GET` list later — not this stage) |
| `lib/validations/unified-sales.ts` | **new** | `unifiedSaleCreateSchema` — decimal quantity, no discount |
| `lib/unified-sales.ts` | **new** | module resolution, the loader, `UNIFIED_SALE_DETAIL_SELECT` |
| `lib/modules.ts` | **1-line add** | a `milk` entry (see §3) |
| `lib/sales.ts` | **small internal extract** | share the missing/inactive checks (see §4) |

**Nothing is removed, nothing rewired.** `/api/beverages/sales` and `/api/bakery/sales` keep working
untouched, and both paths stay live.

## 2. Contract

```http
POST /api/sales          runtime = "nodejs"   dynamic = "force-dynamic"
```

```jsonc
{
  "customerId": "cus_…",
  "saleDate":   "2026-08-12",          // or full ISO; Karachi-day transform, reused verbatim
  "notes":      "optional",
  "items": [
    { "productId": "prod_pepsi_1l", "quantity": 3,    "unitPrice": 250 },   // unitPrice optional
    { "productId": "prod_buns",     "quantity": 12.5 }                      // decimal allowed
  ]
}
```

**No `discountPercent` — anywhere.** Not on the bill, not on a line.

### Why REJECT a discount field rather than ignore it

The brief allows "ignored/rejected". **Reject, with 400.** Silently dropping a `discountPercent` the
caller believed applied is a money bug that shows up on a customer's receipt, and this codebase has
already paid for one 0-vs-null discount ambiguity (`docs/phase-4-bakery-module.md`). A 400 is a
five-second fix for a caller; a silently-ignored discount is a wrong bill.

Implemented with zod `.strict()` on both the sale object and each item object.

### Response

`201` with the `{ data, error }` envelope, `data` = the created sale under
`UNIFIED_SALE_DETAIL_SELECT`, run through `serialize()`.

### Failure modes

| Condition | Status | Body |
|---|---|---|
| Not signed in | 401 | middleware envelope (`requireOwner()` backstop) |
| Body invalid / unknown field / non-2dp quantity | 400 | `fail(firstIssue(...))` |
| Customer missing | 404 | `"That customer no longer exists."` |
| Product id missing | 404 | reused message from the shared check |
| Product deactivated | 400 | reused message |
| **Product's category is not one of the three** | **409** | `"…is in a category that isn't set up for sales…"` |
| Insufficient stock | 409 | `failStockBlocked(...)` + serialized `shortBy` |
| Stock moved mid-write | 409 | `StockConflictError` → `"Stock changed while this sale was being saved."` |
| Total > `MAX_MONEY` | 400 | `checkTotalFits` message |

## 3. `moduleKey` resolution — per line, snapshotted, **zero extra queries**

`SALE_PRODUCT_SELECT` already joins `subCategory: { select: { categoryId: true } }`. The unified
loader extends that join by **one nested field set** — still one query, no extra round trip:

```ts
export const UNIFIED_SALE_PRODUCT_SELECT = {
  id: true, name: true, price: true, stock: true, isActive: true,
  subCategory: {
    select: { categoryId: true, category: { select: { id: true, name: true } } },
  },
} as const;
```

Resolution mirrors `resolveModuleCategoryId`'s existing rule — **seeded id first, case-insensitive
name fallback** — so a renamed category keeps working:

```ts
function resolveLineModule(cat: { id: string; name: string }): ModuleKey | null {
  for (const [key, def] of Object.entries(MODULE_CATEGORIES)) {
    if (cat.id === def.seedId) return key as ModuleKey;
  }
  for (const [key, def] of Object.entries(MODULE_CATEGORIES)) {
    if (cat.name.toLowerCase() === def.name.toLowerCase()) return key as ModuleKey;
  }
  return null;   // -> 409
}
```

### `lib/modules.ts` gains a `milk` entry — and this is what makes milk work later with no code change

```diff
 export const MODULE_CATEGORIES = {
   beverages: { seedId: "cat_beverages", name: "Beverages" },
   bakery:    { seedId: "cat_bakery",    name: "Bakery" },
+  milk:      { seedId: "cat_milk",      name: "Milk Shop" },
 } as const;
```

**Verified safe.** Widening `ModuleKey` breaks nothing: I grepped every use, and there is **no
`Record<ModuleKey, …>` anywhere**. `SaleModule.key: ModuleKey` is a plain field, and the two module
configs are separate consts (`BEVERAGES_MODULE`, `BAKERY_MODULE`), so adding a third key requires no
third config. `lib/receipt.ts` deliberately has its own narrower `ReceiptModuleKey = "beverages" |
"bakery"` and is untouched.

**This is deliberately one source of truth** rather than a second map inside the new file — the
drift CLAUDE.md warns about repeatedly. Until a Milk Shop category exists, `cat_milk` simply never
matches and no line can resolve to `"milk"`; **the moment the milk product is created in its later
gated stage, milk lines resolve with no change here.** That is the requirement, satisfied
structurally.

## 4. The loader — `loadUnifiedSaleProducts`

Same three checks as `loadSaleProducts` (missing / deactivated), **minus** the single-category rule,
**plus** per-line module resolution.

**Recommended:** extract the missing-id and inactive checks in `lib/sales.ts` into two small internal
helpers that *both* loaders call, so the owner-facing messages exist once. The per-module behaviour
is byte-identical afterwards, and the test plan re-runs both old routes to prove it.

*Alternative if you want absolute isolation:* duplicate the two checks in the new file and touch
`lib/sales.ts` not at all. Costs a second copy of two message strings. **I recommend the extract** —
this file's culture is one implementation, and the duplication would be exactly the kind that drifts.

Returns `Map<string, SaleProduct & { moduleKey: ModuleKey }>` or a `SaleProblem`.

## 5. Money — the exact call sequence, no reimplementation

```ts
const lines = items.map((item) => {
  const product = products.get(item.productId)!;          // loader proved it resolves

  const unitPrice = snapshotUnitPrice(product, item.unitPrice);   // create-only override: allowed
  const lineTotal = computeLineTotal(unitPrice, item.quantity);   // discount arg omitted -> 0
  return {
    productId:    item.productId,
    moduleKey:    product.moduleKey,   // snapshotted, per line
    quantity:     item.quantity,
    unitPrice,
    lineTotal,
    netLineTotal: lineTotal,           // no discount => equal, by definition
  };
});

const { total: totalAmount } = computeSaleTotal(lines, new Prisma.Decimal(0));
const tooLarge = checkTotalFits(totalAmount);
if (tooLarge) return fail(tooLarge.message, tooLarge.status);
```

### 💡 The "no discount" decision deletes the hardest part of the original plan

The earlier unified design had to apportion `netLineTotal` **pro-rata with the residue on the largest
line**, because a whole-bill discount does not divide evenly across lines. With no discount:

```
netLineTotal === lineTotal                     per line, by definition
totalAmount  === Σ lineTotal === Σ netLineTotal  exactly, no residue, nothing to apportion
```

`computeSaleTotal(lines, 0)` returns `applySaleDiscount(subtotal, 0)` = `roundMoney(subtotal × 1)` =
`subtotal`. **The Σ-invariant holds by construction rather than by careful rounding**, and the
apportionment logic — the single most error-prone piece of the whole rework — is not written at all.
Worth stating plainly so nobody re-adds it "for completeness".

If a bill discount is ever wanted, *that* is when apportionment gets designed, as its own change.

## 6. Stock

```ts
const stockDeltas = computeStockDeltas([], { updates: [], creates: lines, removedIds: [] });
const shortfalls  = findStockShortfalls(stockDeltas, products);
if (shortfalls.length > 0) {
  return failStockBlocked(stockBlockMessage(shortfalls), shortfalls);   // 409, all-or-nothing
}
```

Identical to the per-module create — the reconciliation-against-nothing idiom, not a second code path.

**Milk lines decrement stock like any other product line.** That is the whole reason Migration D
widened the column, and it needs no special case. (The *delivery-to-stock bridge* — farmer deliveries
*increasing* milk stock — is the later stage and is not this.)

## 7. Transaction — both changes the brief asks for

```ts
const created = await prisma.$transaction(
  async (tx) => {
    // Stock FIRST: its conditional guard aborts before any Sale row exists.
    await applyStockDeltas(tx, stockDeltas);
    return tx.sale.create({
      data: {
        customerId, saleDate, notes: notes ?? null,
        // discountPercent omitted on purpose -> DB default 0 (Sale and SaleItem both)
        totalAmount,
        items: { create: lines },
      },
      select: { id: true },          // MINIMAL — the read-back is outside
    });
  },
  { timeout: 15_000, maxWait: 5_000 }
);

// OUTSIDE the transaction: the expensive read no longer holds the lock or the clock.
const sale = await prisma.sale.findUniqueOrThrow({
  where: { id: created.id },
  select: UNIFIED_SALE_DETAIL_SELECT,
});
return ok(serialize(sale), 201);
```

**Why moving the read-back out matters here more than it did before.** At ~1.1s per round trip, the
old create held the transaction open across the deep `SALE_DETAIL_SELECT` join — inside a **5s**
budget. A 3-product bill is 3 stock updates + 1 create + 1 deep read ≈ 5 round trips ≈ **5.5s, past
the default**. Raising to 15s *and* moving the read out attacks it from both ends: the transaction
now holds only the writes.

**Error mapping:** catch `StockConflictError` → 409 with its message; everything else →
`serverError("sales.POST", error)`.

### Query budget

| # | Query | In tx |
|---|---|---|
| 1 | customer exists | no |
| 2 | products (`UNIFIED_SALE_PRODUCT_SELECT`, one `findMany`) | no |
| 3…2+N | `applyStockDeltas` — one per DISTINCT product | **yes** |
| 3+N | `sale.create` nested items | **yes** |
| 4+N | read-back | no |

**A 3-product bill ≈ 7 queries ≈ 7.7s**, of which only ~4.4s is inside the transaction. Comfortably
under both the 15s transaction timeout and the 15s client timeout. Module resolution costs **zero**
queries because it rides the product join.

⚠️ **Do not add a query to this route without recounting** — CLAUDE.md's ~12-query cliff applies, and
`applyStockDeltas` already scales with line count.

## 8. Response select — `UNIFIED_SALE_DETAIL_SELECT`

`SALE_DETAIL_SELECT` + the two unified columns:

```ts
export const UNIFIED_SALE_DETAIL_SELECT = {
  ...SALE_DETAIL_SELECT,
  items: {
    select: {
      ...SALE_DETAIL_SELECT.items.select,
      moduleKey:    true,    // NOT in SALE_DETAIL_SELECT — it targets the old tables
      netLineTotal: true,
    },
    orderBy: { id: "asc" },  // cuid is time-prefixed => insertion order
  },
} as const;
```

Kept as a spread of the existing constant so the shared fields cannot drift.

---

# STEP 2 — Test plan for the implementation turn

All test rows `ZZ_TEST_`-prefixed and removed afterwards. **Never touch the 2 real sales
(bakery 5,000 / milk 6,000), Saif, or any farmer data.** Baseline and re-check the value-stable
product fingerprint `91c0ca3185c4daadd4a9c7be1bfa0e77` before and after.

| # | Test | Pass condition |
|---|---|---|
| 1 | **Mixed beverage + bakery bill** | 201; reconciles **to the paise** against hand arithmetic |
| 2 | **Σ invariant, checked in SQL** | `SELECT SUM("netLineTotal") FROM "SaleItem" WHERE "saleId"=…` **equals** `Sale.totalAmount` exactly |
| 3 | **`moduleKey` per line** | beverage line `"beverages"`, bakery line `"bakery"` — read from the DB, not the response |
| 4 | **Stock across both categories** | each product down by exactly its quantity; unrelated products unchanged |
| 5 | **Decimal quantity** | a `12.5` line stores `12.50` and computes `unitPrice × 12.5` exactly |
| 6 | **Price override honoured on create** | explicit `unitPrice` wins over catalog price (create-only rule) |
| 7 | **Omitted `unitPrice`** | snapshots the current catalog price |
| 8 | **🔴 All-or-nothing shortfall** | one line over stock → **409**, **NO `Sale` row**, **NO `SaleItem`**, and **stock unmoved on EVERY line including the satisfiable ones** |
| 9 | **Discount rejected** | `discountPercent` on bill or line → **400**, not silently dropped |
| 10 | **Unknown field rejected** | `.strict()` → 400 |
| 11 | **Non-2dp quantity** | `1.005` → 400 |
| 12 | **Quantity ≤ 0** | `0` and `-1` → 400 |
| 13 | **Bad category → 409** | a product whose category is neither seeded nor name-matching |
| 14 | **Missing / deactivated product** | 404 / 400 with the same messages the per-module routes give |
| 15 | **Missing customer** | 404 |
| 16 | **Transaction duration** | measured, **well under 15s**; log the round-trip count |
| 17 | **🔴 Old per-module paths unchanged** | a `ZZ_TEST_` beverage sale AND a bakery sale via the old routes still create, decrement stock, and delete-restore — proves the `lib/sales.ts` extract was behaviour-neutral |
| 18 | **`.int()` validator still strict** | `2.5` to `/api/beverages/sales` still **400** — the shared validator was not relaxed |
| 19 | **Signed out** | 401 JSON envelope, not an HTML redirect |
| 20 | **Cleanup verified** | all `ZZ_TEST_` gone; `Sale` back to its 1 migration-A row; fingerprint matches baseline |

**#8, #17 and #18 are the ones that would actually catch a regression** — respectively: partial
commit, collateral damage from the extract, and the shared validator being loosened by accident.

### ⚠️ Milk is NOT tested this stage — and cannot be

**No milk `Product` exists** (no Milk Shop category, no milk product), so no line can resolve to
`"milk"` and there is nothing to assert. The design makes milk work **structurally** — the
`cat_milk` entry in §3 and a `Decimal` quantity + `Decimal` stock — so the later gated stage that
creates the milk product should need **no change to this endpoint**.

What that stage must test, recorded here so it is not lost: a milk line resolving to `moduleKey
"milk"`, a fractional-litre quantity end-to-end, milk stock decrementing, and a genuinely
three-module mixed bill.

---

# Constraint compliance

| Constraint | Status |
|---|---|
| Read-only; no code, no migration, no DB write | ✅ only `SELECT`s and file reads |
| No money-logic reimplementation | ✅ every figure via `lib/sales.ts`; call sequence given verbatim |
| No `Sale`-path removal, no reporting repoint, no receipt work, no unified screen | ✅ none designed |
| Milk `Product` NOT created; stock bridge NOT built | ✅ explicitly deferred |
| Farmer code untouched | ✅ never opened |
| Shared `.int()` validator NOT relaxed | ✅ new `unifiedSaleCreateSchema` alongside; test #18 guards it |
| Built alongside — both paths live | ✅ nothing removed or rewired |
| No dependency installs, never `--shadow-database-url` | ✅ |

---

# Open questions for you (they affect the implementation turn, not this design)

1. **The `lib/sales.ts` extract in §4** — recommended, or would you rather duplicate the two checks
   and leave that file untouched? My recommendation is the extract; test #17 exists to prove it safe.
2. **`GET /api/sales`** (list) — not designed this stage. The unified screen (S4) will need it. Say
   if you want it folded into the implementation turn or kept separate.
3. **Nothing else is blocked.** Q1 (per-category receipt subtotals) and Q3 (how the owner enters a
   milk line) from the earlier design are **S4 screen questions** and do not gate this endpoint.

**No code was written. Awaiting your review.**
