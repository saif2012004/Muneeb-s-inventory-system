# Milk product + delivery-to-stock bridge — recon & design

**Date:** 2026-08-13
**HEAD:** `90e8609` · tree clean (untracked docs only) · **9 migrations, "up to date"** ✅
**This turn:** read-only. Zero code edits, zero migrations, zero DB writes.

---

## 🔴 Read this first — the finding that changes the shape of the work

**Quick entry's EVENING pass is an UPDATE of the morning's row.** It is not an edge case; it is the
normal daily flow, and the owner does it twice a day, every day.

`app/api/milk/deliveries/quick-entry/route.ts:271-286` — for each farmer, if a delivery already
exists for that Karachi day it **updates** it, otherwise it creates one. That is by design: CLAUDE.md
records "quick entry finds the day's row and UPDATES it, which is how the evening pass lands on the
same row as the morning."

**Consequence:** if the bridge only hooks CREATE, then every single evening, stock gains nothing
while litres go up — or, worse, if it naively added `totalLiters` on update too, the morning's litres
would be counted twice daily. **Update reconciliation is mandatory from day one.** Deferring it is
not a documentable known-limit here; it would be a guaranteed daily drift.

This is why the brief was right to review before code.

---

# STEP 1 — Recon

## 1.1 There are FOUR delivery write paths, not two

| # | Path | Verb | File | Transaction |
|---|---|---|---|---|
| 1 | `/api/milk/farmers/[id]/deliveries` | POST | `.../deliveries/route.ts:114` | ❌ none |
| 2 | `/api/milk/farmers/[id]/deliveries/[deliveryId]` | PATCH | `.../[deliveryId]/route.ts:58` | ❌ none |
| 3 | `/api/milk/farmers/[id]/deliveries/[deliveryId]` | DELETE | `.../[deliveryId]/route.ts:154` | ❌ none |
| 4 | **`/api/milk/deliveries/quick-entry`** | POST | `quick-entry/route.ts:167` | ✅ `{ timeout: 25_000, maxWait: 15_000 }` |

**All four mutate litres. All four need the bridge.** Missing any one drifts stock.

### Path 1 — create (`deliveries/route.ts:153-173`)

```ts
const totals = computeDeliveryTotals(morningLiters, eveningLiters, ratePerLiter);

const delivery = await prisma.milkDelivery.create({
  data: { farmerId: params.id, deliveryDate, notes: notes ?? null, ...totals },
  select: DELIVERY_SELECT,
});

const balance = await getFarmerBalance(params.id);
return ok(serialize({ delivery, balance }), 201);
```

A **bare create, no transaction.** Adding a stock write means introducing one.

### Path 2 — edit (`[deliveryId]/route.ts:120-135`)

Merges the patch onto the stored row, recomputes totals, then `prisma.milkDelivery.update(...)`.
**Litres can change here**, so stock must move by the difference. Bare update, no transaction.

### Path 3 — delete (`[deliveryId]/route.ts:165`)

```ts
await prisma.milkDelivery.delete({ where: { id: existing.id } });
```

A genuine hard delete. Stock must come back down by the deleted litres.

### Path 4 — quick entry (`quick-entry/route.ts:267-293`)

Already transactional. Splits work before opening the transaction, then per farmer either
`tx.milkDelivery.update(...)` or `tx.milkDelivery.create(...)`.

**Never deletes** — a blanked row is reported in `clearedButKept` and the stored delivery survives
(`:241-251`). So quick entry needs create + update handling only, no removal case.

### ⚠️ Three selects do not currently carry `totalLiters` — a delta cannot be computed without it

| Where | Currently selects | Needs |
|---|---|---|
| `findScopedDelivery` (`[deliveryId]/route.ts`) | `id, deliveryDate, morningLiters, eveningLiters, ratePerLiter` | **+ `totalLiters`** |
| quick entry's `existing` lookup (`:216-222`) | `id, farmerId` | **+ `totalLiters`** |
| `DELIVERY_SELECT` (`lib/milk.ts`) | already has `totalLiters` ✅ | — |

The PATCH/DELETE lookup *could* derive prior litres from morning+evening, but selecting the stored
`totalLiters` is the honest source — it is the value that was actually added to stock.

## 1.2 The milk product does not exist — confirmed against the live database

```
cat_milk exists        : 0
all categories         : cat_bakery = Bakery | cat_beverages = Beverages
products named 'milk'  : 0
sub-categories 'milk'  : 0
MilkDelivery rows      : 1  (250.00 L)
```

### How everything else was seeded (`prisma/seed.ts:255-281`)

```ts
for (const category of CATEGORIES)     await prisma.category.upsert({ where:{id}, update:{}, create: category });
for (const subCategory of SUB_CATEGORIES) await prisma.subCategory.upsert({ where:{id}, update:{}, create: subCategory });
for (const product of PRODUCTS)        await prisma.product.upsert({ where:{id}, update:{}, create:{ ...product, price: 0, isActive: true } });
```

**Deterministic ids, `update: {}` so it is purely additive** — re-running never resets an owner-set
price. Not wrapped in a transaction (deliberate: 75 sequential upserts would risk the pool timeout).
A product seed row is `{ id, name, subCategoryId, size, qualityTier, shape, unit }`; `price: 0` and
`isActive: true` are added at the upsert, and **`stock` falls through to the schema default of 100**.

## 1.3 How `Product.stock` is adjusted today

| Mechanism | Where | Shape |
|---|---|---|
| **Sale** (create/edit/delete) | `applyStockDeltas`, `lib/sales.ts:755` | conditional `updateMany` — `where: { id, stock: { gte: -delta } }`, `data: { stock: { increment: delta } }`; `count === 0` → `StockConflictError` |
| **Manual correction** | `PATCH /api/products/[id]` | sets stock outright (the inline catalog editor). CLAUDE.md: "THIS SETS STOCK, IT DOES NOT ADJUST IT" |

`applyStockDeltas` is the *only* relative-adjustment mechanism, and its `gte` guard is what enforces
"never negative" **in the database** rather than in JS. The bridge should use it, not a second
mechanism.

## 1.4 ✅ Farmer money math is structurally stock-free

```
$ grep -c "product\|stock" lib/milk.ts
0
```

**Zero references.** `lib/milk.ts` — which owns `getFarmerBalance`, `getFarmerBalances`,
`summariseFarmerBalances`, `getAllFarmerTotals`, `buildFarmerLedger` — cannot read `Product` or
`stock` at all. Farmer balances are computed purely from `MilkDelivery.totalAmount` and
`FarmerPurchase.amount`.

**This is the strongest guarantee in the whole design:** the bridge *cannot* change a farmer figure,
because farmer figures never look at the thing the bridge writes. It is not a promise to be careful —
it is a property of the code.

### Farmer surfaces to re-verify after the bridge

| Surface | Route |
|---|---|
| Milk hub | `/milk` |
| Quick entry | `/milk/quick-entry` |
| Balance sheet | `/milk/balances` |
| Farmer profile + ledger | `/milk/farmers/[id]` |
| Milk sales list | `/milk/sales` |

## 1.5 🔴 A second finding: there will be TWO ways to sell milk, and only one moves stock

`POST /api/milk/sales` does **not** touch `Product.stock` — grep confirms no `stock`, no
`applyStockDeltas`, no `product`. Its own docblock explains why (`route.ts:25-27`):

> *"A beverage or bakery sale is a basket of catalog products … [a milk sale is] with no items table,
> no product FK and nothing to snapshot — the rate typed at the till."*

So once milk is a Product:

| Selling milk via | Decrements milk stock? |
|---|---|
| `POST /api/sales` (unified, S3) | **YES** |
| `POST /api/milk/sales` (existing screen at `/milk/sales`, which the owner uses today) | **NO** |

**Deliveries would add stock that the screen the owner actually uses never takes away**, so milk
stock would climb forever. This is not in the brief's scope and I am **not** designing a change to
`MilkSale` — but it must be a conscious decision before the bridge ships, not a discovery afterwards.
Options are laid out in §2.6.

---

# STEP 2 — The design

## 2.1 No migration needed — confirmed

`Category`, `SubCategory` and `Product` are **data rows**. The schema already supports everything:
`Product.stock` is `numeric(10,2)` (Migration D) and `SaleItem.quantity` is `numeric(10,2)`
(Migration C). **Nothing to migrate.** The milk product is created as data, the same way the other
27 products were.

## 2.2 The milk product

Added to `prisma/seed.ts` alongside the existing arrays, so it is created by the same idempotent
`upsert` mechanism and `npm run seed` stays re-runnable.

```ts
// CATEGORIES
{ id: "cat_milk", name: "Milk Shop" },          // matches MODULE_CATEGORIES.milk from S3

// SUB_CATEGORIES
{ id: "sub_milk", name: "Milk", categoryId: "cat_milk" },

// PRODUCTS
{ id: "prod_milk", name: "Milk", subCategoryId: "sub_milk",
  size: null, qualityTier: null, shape: null, unit: "litre" },
```

**`name: "Milk Shop"` must match `MODULE_CATEGORIES.milk.name` exactly** (`lib/modules.ts`), because
`resolveLineModule` falls back to a case-insensitive name match if the seeded id is ever missing.
With `id: "cat_milk"` the seeded-id branch hits first and the line resolves to `moduleKey "milk"` —
**with no change to `/api/sales`**, exactly as S3 built it.

`unit: "litre"` needs no other work: `SELF_EVIDENT_UNITS` is `{"bottle", "piece"}`
(`lib/sale-catalog.ts:140`), so `unitIsInformative("litre")` is **true** and the sale form will
automatically label the field "Quantity (litres)" — the same treatment eggs get for cottons.

### 🔴 Starting stock must be **0**, and this is the one place the seed default is actively wrong

Every other product falls through to `Product.stock`'s default of **100** — a placeholder the owner
replaces by counting the shelf. **Milk must not.** Its stock is *derived*: deliveries add, sales
subtract. Seeding 100 would invent 100 litres that never arrived, and the first delivery would make
the number wrong rather than right.

So the milk product is created with an **explicit `stock: 0`**, which means the seed's shared upsert
(`create: { ...product, price: 0, isActive: true }`) needs a per-product stock override rather than
relying on the default. Small change; call it out in review because it is easy to miss.

**Price:** `0` like every other seeded product — the owner sets the catalog rate, overridable at
billing like any product, per the requirement.

## 2.3 Where the bridge lives — `lib/milk-stock.ts` (new)

**Not in `lib/milk.ts`.** S2 deliberately split farmer code out so the unified-sale work could not
reach farmer balances by accident, and §1.4 shows `lib/milk.ts` currently has *zero* product/stock
references. That property is worth keeping: it is what makes "the bridge cannot change a farmer
figure" checkable with a grep rather than a review.

```ts
// lib/milk-stock.ts
export const MILK_PRODUCT_ID = "prod_milk";

/** The milk product's id, or null if the catalog has no milk product. */
export async function findMilkProductId(): Promise<string | null>;

/** Apply a signed litre delta to milk stock inside an existing transaction. */
export async function applyMilkStockDelta(
  tx: Prisma.TransactionClient,
  productId: string,
  deltaLiters: Prisma.Decimal | number
): Promise<void>;
```

`applyMilkStockDelta` delegates to **`applyStockDeltas` from `lib/sales.ts`** rather than writing a
second conditional update. That keeps "never negative" as one implementation, enforced in the
`WHERE` clause by the database.

## 2.4 The hook points

Every path resolves the milk product **once, outside** the transaction (one extra query; at ~1.1s a
round trip that matters), then applies the delta **inside** it.

| Path | Delta |
|---|---|
| **Create** (paths 1 & 4-create) | `+ totalLiters` |
| **Edit** (paths 2 & 4-update) | `+ (newTotalLiters − priorTotalLiters)` |
| **Delete** (path 3) | `− totalLiters` |

**Atomicity.** Paths 1, 2 and 3 currently have no transaction and must gain one, so a delivery cannot
record without its stock landing or vice versa. Path 4 already has one; the delta writes join it.

**Ordering.** Unlike the sale routes — which write stock *first* so the guard aborts before a sale row
exists — the delivery routes should write **the delivery first, then the stock**. The reason is the
inverse risk profile: a delivery is the farmer's record of milk they actually handed over, and it is
the thing the owner owes money for. If the two cannot both succeed, the transaction rolls back either
way; but ordering the delivery first keeps the farmer record as the primary write and the stock as
the side-effect, which is what it is.

**Query cost.** Quick entry gains 1 lookup + up to N delta writes on an existing ~4+N. Within its 25s
transaction budget, but worth measuring in the implementation turn (test #12).

## 2.5 🔴 The hard part — edit and delete. **In scope, not deferred.**

Per the headline finding, **update reconciliation cannot be deferred**: quick entry's evening pass is
an update, so deferring guarantees daily drift. Delete is rarer but drifts permanently when it
happens. **Both are designed in.**

### The genuinely hard case: a downward delta that would drive stock negative

The owner records 250 L, sells 240 L (stock 10 L), then deletes the delivery as a mis-entry. The
delta is −250 against a stock of 10.

`applyStockDeltas`' guard refuses it: `where: { stock: { gte: 250 } }` matches nothing, `count === 0`,
`StockConflictError`. **That is the correct outcome — stock must never go negative** — but the raw
error message is *"Stock changed while this sale was being saved. Reload and try again."*, which is
wrong on both counts in a delivery context.

**Design: reuse the guard, re-word the failure at the route.** Catch `StockConflictError` in the four
delivery routes and return a delivery-specific **409**:

> *"This delivery's 250 litres can't be taken back out of stock — only 10 litres are on hand, so some
> of it has already been sold. Correct the milk stock in the catalog first, then delete the delivery."*

**Why this does not trap the owner.** The escape hatch already exists and is the right one: manual
stock correction (`PATCH /api/products/[id]`, the inline catalog editor) sets stock outright. If the
delivery never happened, the stock was never really there, and correcting it is exactly the action
that makes the records true. The message names that action explicitly.

**Rejected alternatives, and why:**

| Option | Rejected because |
|---|---|
| Allow negative stock on reversal | Breaks the invariant the whole stock feature rests on; CLAUDE.md is explicit that stock is never negative |
| Clamp the delta at zero | Silently swallows the discrepancy — this is precisely how stock drifts from reality |
| Block delivery edit/delete entirely | Changes farmer behaviour, which the brief forbids |
| Defer edit/delete reconciliation | Guaranteed daily drift via quick entry's evening update |

**One consequence to accept openly:** in this specific situation the owner must do two steps instead
of one. That is the honest price of never letting stock lie, and the message makes the second step
obvious rather than leaving them stuck.

### If the milk product is missing

`findMilkProductId()` returns null (someone deleted it, or the seed has not run). **The delivery
still records and the stock step is skipped, with a server-side `console.error`.**

Deliberate: *the farmer's record must never be blocked by a catalog problem.* Refusing the delivery
would change farmer behaviour, which the brief forbids outright. Since the product is created in the
same gated stage as the bridge, this is a should-never-happen — but the fallback must be "record the
delivery" rather than "500 the owner's morning entry".

## 2.6 🔴 Decision needed before implementation: the two milk-selling paths

Per §1.5, `POST /api/milk/sales` does not decrement stock. Deliveries adding stock that the existing
milk-sales screen never removes means the number climbs forever and is wrong within a day.

I am **not** designing this change — it is outside the brief — but the bridge should not ship without
a decision. The options, with my read:

| Option | Effect | My view |
|---|---|---|
| **A. Sell milk only through the unified `/api/sales`** | Consistent; `MilkSale` becomes legacy alongside `BeverageSale`/`BakerySale` and retires with them | **Cleanest**, and it is the direction the whole unified rework is already heading |
| **B. Add a stock decrement to `POST /api/milk/sales`** | Both paths correct | Duplicates stock logic into a table with no product FK; more code, and it invests in a path that is meant to retire |
| **C. Ship the bridge, accept milk stock is inflated until S4** | Fastest | **Only acceptable if explicitly time-boxed** — an inflated stock number silently permits oversells |

**Recommendation: A**, with the bridge shipping now and milk selling moving to `/api/sales` at S4.
If you prefer C as an interim, the implementation turn should say so in `CLAUDE.md` so the number is
known-wrong rather than trusted.

## 2.7 No farmer figure changes — how it is guaranteed

| Figure | Source | Touched by the bridge? |
|---|---|---|
| `MilkDelivery.totalLiters` / `.totalAmount` | `computeDeliveryTotals` | ❌ unchanged — the bridge *reads* litres |
| `FarmerPurchase.amount` | not involved | ❌ |
| `netBalanceOwed`, ledger running total | `lib/milk.ts` | ❌ **structurally impossible** — zero product/stock refs (§1.4) |
| Balance-sheet totals | `summariseFarmerBalances` | ❌ same |

The bridge writes exactly one column on one table: `Product.stock`. It is **stock-only**, and no
farmer money math reads that column.

---

# STEP 3 — Test plan for the implementation turn

All `ZZ_TEST_`-scoped. Baseline both fingerprints (stock `91c0ca31…`, product `b57a51bb…`) before and
after — noting **the stock fingerprint will legitimately change** once `prod_milk` exists, so capture
a fresh post-creation baseline and use the *product* fingerprint plus explicit per-row checks for the
27 pre-existing products.

### Milk end-to-end — what S3 could not test

| # | Test | Pass condition |
|---|---|---|
| 1 | Milk product resolves in `POST /api/sales` | line stores `moduleKey = "milk"`, read from the DB |
| 2 | **Fractional-litre milk line** | `12.5 L × rate` reconciles **to the paise**; `quantity` stored `12.50` |
| 3 | **Genuine THREE-module bill** | beverage + bakery + milk on one `Sale`; `Σ netLineTotal == totalAmount` in SQL; three distinct `moduleKey`s |
| 4 | Milk sale decrements milk stock | `prod_milk.stock` down by exactly the litres sold |
| 5 | No change to `/api/sales` was needed | the endpoint file is untouched in the diff |

### The bridge

| # | Test | Pass condition |
|---|---|---|
| 6 | **Create adds stock** | `POST .../deliveries` of 40 L → milk stock **+40.00** |
| 7 | **🔴 Quick entry: morning creates, evening UPDATES** | morning 30 L → stock +30; evening pass making it 30+20=50 → stock **+20 more, not +50**. *The headline case* |
| 8 | **Edit reconciles by delta** | PATCH 40 L → 25 L moves stock **−15**; 40 L → 60 L moves **+20** |
| 9 | **Delete removes stock** | delete a 40 L delivery → stock **−40** |
| 10 | **🔴 Downward delta that would go negative** | with stock below the delivery's litres, delete → **409** with the delivery-specific message; **delivery still exists**, **stock unchanged** |
| 11 | Atomicity | a forced failure inside the transaction leaves **neither** the delivery **nor** the stock change |
| 12 | Quick-entry duration | full round of farmers well inside the 25s transaction budget |
| 13 | Missing milk product | delivery still records, stock step skipped, error logged — **no 500** |
| 14 | Manual milk-stock correction still works | inline catalog editor sets milk stock outright |

### 🔴 Farmer figures byte-identical — the regression-catchers

| # | Test | Pass condition |
|---|---|---|
| 15 | **Farmer balance unchanged** | with the existing 250 L @ 30,000 delivery and 25,000 purchase, **net owed still exactly 5000.00** before and after every bridge operation |
| 16 | **Ledger running total unchanged** | `buildFarmerLedger` walks `30000 → 5000` exactly as before |
| 17 | **All five farmer surfaces 200 and unchanged in value** | `/milk`, `/milk/quick-entry`, `/milk/balances`, `/milk/farmers/[id]`, `/milk/sales` |
| 18 | **Delivery/purchase amounts untouched** | `totalLiters` 250.00, `totalAmount` 30000.00, purchase 25000.00 |
| 19 | `lib/milk.ts` still has **zero** product/stock references | `grep -c "product\|stock" lib/milk.ts` → **0** — the structural guarantee still holds |

### Cleanup / integrity

| # | Test | Pass condition |
|---|---|---|
| 20 | Per-module + unified sale paths still work | beverages and bakery unaffected |
| 21 | All `ZZ_TEST_` removed | test deliveries and sales gone; milk stock back to its pre-test value |
| 22 | Real data untouched | 2 real sales (5,000 / 6,000), Saif, farmer data; product fingerprint reconciles for the 27 pre-existing products |

**#7, #10 and #15 are the regression-catchers** — respectively the daily-drift case, the
never-negative case, and the promise that farmer money is untouched.

---

# Constraint compliance

| Constraint | Status |
|---|---|
| Read-only; no code, no migration, no DB write | ✅ only `SELECT`s and file reads |
| Bridge is STOCK-ONLY, no farmer money change | ✅ §2.7 — structurally guaranteed by §1.4 |
| No sale money math reimplemented | ✅ milk selling already works via S3 |
| No change to `/api/sales` | ✅ milk resolves through it as-is (test #5 proves it) |
| Never `--shadow-database-url`, no dependency installs | ✅ |

---

# Summary of what needs your decision

1. **§2.6 — the two milk-selling paths.** `POST /api/milk/sales` does not decrement stock, so
   deliveries would inflate milk stock forever. **Recommend option A** (milk sells through
   `/api/sales`; `MilkSale` retires with the other legacy tables). This is the one item I would not
   ship the bridge without settling.
2. **§2.5 — the never-negative refusal.** Confirm you are happy that a delete which would drive stock
   negative is **refused with a 409 naming the fix**, rather than allowed, clamped, or deferred.
3. **§2.2 — milk starts at `stock: 0`**, not the schema's default 100, which needs a small per-product
   override in the seed's upsert.

**No code was written. Awaiting review.**
