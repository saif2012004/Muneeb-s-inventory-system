# S1 — Migration C: analysis + prepared migration. **NOT APPLIED. AWAITING YOUR GO.**

**Date:** 2026-08-11
**Status:** 🔴 **STOPPED BEFORE APPLYING** — no Supabase branch or restored copy is available for a
dry-run, so per your instruction I stopped rather than applying to live first.
**Database: completely untouched.** Still `quantity integer`, 7 migrations applied.

---

## STEP 0 — Ground truth

```
$ git log --oneline -1
95122e1 fix: speed up sheet open (500ms felt slow)

$ git status --porcelain    (tracked modifications: 0)
?? docs/responses/…  ×5
```

**HEAD = `95122e1`** ✅ · tracked modifications **0** · deletions **0**.

---

## STEP 1 — Schema-need analysis

**Your expectation was correct on all four points.** Read from the live schema, not the Prisma file.

Live `SaleItem` columns:

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id`, `saleId`, `productId`, `moduleKey` | `text` | NO | — |
| **`quantity`** | **`integer`** (prec 32, scale 0) | NO | — |
| `unitPrice` | `numeric(10,2)` | NO | — |
| `discountPercent` | `numeric(5,2)` | NO | `0` |
| `lineTotal`, `netLineTotal` | `numeric(10,2)` | NO | — |

Constraints on `SaleItem` — **there are only three, and no CHECK at all**:

```
SaleItem_pkey             PRIMARY KEY (id)
SaleItem_saleId_fkey      FOREIGN KEY (saleId)    REFERENCES Sale(id)    ON DELETE CASCADE
SaleItem_productId_fkey   FOREIGN KEY (productId) REFERENCES Product(id) ON DELETE RESTRICT
```

### Point by point

| # | Your expectation | Finding |
|---|---|---|
| 1 | `quantity: Int → Decimal(10,2)` — **needed** | ✅ **CONFIRMED, and it is the only schema change required.** `integer` today; milk needs 2.5 L |
| 2 | `moduleKey`: allow `"milk"` — confirm nothing blocks it | ✅ **CONFIRMED — needs NO schema change at all.** Bare `text`, no CHECK, no enum, no domain. `"milk"` is simply a value it can already hold |
| 3 | `productId` nullable — **likely not needed** | ✅ **CONFIRMED NOT NEEDED.** Justification below |
| 4 | `description` column — **likely not needed** | ✅ **CONFIRMED NOT NEEDED.** Justification below |

### Why 3 and 4 fall away, given milk-as-a-Product

Both existed in the recon doc **only** to support a productless milk line. Milk becoming a real
`Product` removes the reason entirely:

- **`productId` stays `NOT NULL`.** A milk line points at the milk `Product` like any other line.
  Keeping it non-null is strictly better than widening: the FK stays enforced, so a sale line can
  never reference a product that doesn't exist, and no code needs a null branch.
- **No `description` column.** The label is `product.name`, exactly as beverages and bakery already
  do — `SALE_DETAIL_SELECT` already joins `product.name` for every line. A snapshotted description
  would be a *second* source of truth for the same string.
- **Bonus:** `unitPrice` already handles "catalog rate, overridable at billing".
  `snapshotUnitPrice()` honours a client override **on create only** (server-authoritative on
  update, closed in `62cf0d2`). That is precisely the semantics milk needs — no new mechanism.

### `moduleKey` blast radius — **zero today**

Every occurrence of `moduleKey` in the codebase, and none of them reads `SaleItem.moduleKey`:

| Location | What it actually is |
|---|---|
| `app/api/reports/top-products/route.ts:35,36,56` | a **local variable** parsed from a query param, typed `ProductModule`; feeds the OLD per-module tables |
| `app/api/reports/trend/route.ts:42,43,87` | same — local variable, `TrendModule` |
| `lib/receipt.ts:70,119,123,148,149` | its own `ReceiptModuleKey = "beverages" \| "bakery"`, reading the OLD tables |
| `app/receipt/[module]/[id]/page.tsx:52` | `receipt.moduleKey` from that same receipt type |
| `prisma/schema.prisma:186,204` | the column and its index |

The two value-constraining lists, **for later (S6), not touched now**:

```ts
lib/reports.ts:80   export const TREND_MODULES   = ["beverages", "bakery", "milk"] as const;  // already has milk
lib/reports.ts:187  export const PRODUCT_MODULES = ["beverages", "bakery"] as const;          // will need milk
lib/receipt.ts:51   export type ReceiptModuleKey = "beverages" | "bakery";                    // will need milk
```

**Nothing switches on `SaleItem.moduleKey`, so adding `"milk"` breaks nothing.**

### ⚠️ Two consequences of "NO discounts in the new path" — worth your attention

Neither changes S1, but both change the plan I gave you:

1. **`netLineTotal` becomes structurally equal to `lineTotal`.** That column exists solely to
   apportion a whole-bill discount pro-rata. With no discounts, the apportionment is the identity
   function. **This deletes the single biggest risk and cost from the earlier estimate** — I had S3
   at 2–3 sessions largely because of apportionment rounding (old Risk R1). That risk is now gone.
   The column stays (removing it would be a drop, and you said leave existing columns).
2. **`Sale.discountPercent` and `SaleItem.discountPercent` stay, defaulting to `0`.** The new path
   simply never writes them. No schema change, and the old tables keep theirs untouched, as
   instructed.

### One thing to decide before milk-as-a-Product data is created (NOT S1)

A milk `Product` needs a `Category`, and only **Bakery (10 products)** and **Beverages (17)** exist —
verified live. So a third category is needed, plus a sub-category. Also `Product.stock` defaults to
**100**, which would be meaningless for milk until the stock bridge lands. **Both are data
decisions for the step that creates the milk product, not schema, and not S1.**

---

## STEP 2 — Migration C

### The schema change

```diff
- /// "beverages" | "bakery" — a SNAPSHOT of what this line was sold as.
+ /// "beverages" | "bakery" | "milk" — a SNAPSHOT of what this line was sold as.
  …
  moduleKey       String
- quantity        Int
+ /// DECIMAL, not Int: milk sells in LITRES and 2.5 L is a real quantity.
+ quantity        Decimal @db.Decimal(10, 2)
```

The `moduleKey` edit is **comment-only** and produces no SQL — included so the schema documents the
new value rather than drifting.

### The generated SQL — literal, 91 bytes

Produced by `prisma migrate diff` against the live datasource (read-only; it applies nothing):

```sql
-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(10,2);
```

**One statement.** No column added, none dropped, no data touched, no constraint altered.
Saved at `prisma/migrations/20260811120000_widen_saleitem_quantity/migration.sql`.

### Is `integer → numeric(10,2)` lossless? **Yes.**

- Postgres widens `integer` → `numeric` by an implicit, value-preserving cast. Every `int32` is
  exactly representable in `numeric(10,2)`: 10 significant digits with 2 after the point leaves 8
  before it, and the current values are far inside that.
- It rewrites the table (not a metadata-only change), so it takes an `ACCESS EXCLUSIVE` lock — on a
  **1-row table**, which is instant.
- **Reversible**, with one caveat: `ALTER … TYPE INTEGER USING quantity::integer` restores the type,
  but would round any fractional value written in between. Until milk lines exist, every value is a
  whole number and the reversal is exact.

**One honest caveat on "untouched":** the stored value does not change, but its *text
representation* does — `100` renders as `100.00` once the column is `numeric(10,2)`. Numerically
identical; textually different. Any fingerprint built from `quantity::text` will differ by design.

### Does Prisma surface the change at COMPILE time? **Yes — and nothing broke.**

Regenerated the client (schema-only; no database access) and confirmed the type flipped:

```ts
// node_modules/.prisma/client — SaleItem payload scalars
id: string
saleId: string
productId: string        // ← still NOT nullable, as designed
moduleKey: string
quantity: Prisma.Decimal // ← was `number`
unitPrice: Prisma.Decimal
```

Then:

| Check | Result |
|---|---|
| `tsc --noEmit` (4096 heap) | **exit 0** |
| `next lint` | **clean** |
| `npm run build` | **green** |
| **What newly fails typecheck** | **NOTHING** |

That nil result is itself the confirmation of §1's blast-radius finding: **no application code reads
`SaleItem` at all**, so a `number → Decimal` change on it has nowhere to bite. When the unified path
is built (S3/S4) it will consume `Decimal` from the start.

### 🔴 DRY-RUN: not possible — stopping here

`mcp__supabase__list_branches` fails with `Project reference is missing when validating
permissions`, and CLAUDE.md records the project as **Supabase free tier** (the Pro upgrade is
CHECKLIST #3, still open). Branching is a paid feature, and no restored copy exists.

**Per your instruction — "If not, STOP before applying and tell me — we decide together" — I have
not applied it.** Prisma confirms:

```
$ npx prisma migrate status
8 migrations found in prisma/migrations
Following migration have not yet been applied:
20260811120000_widen_saleitem_quantity
```

**Options, your call:**

| | Option | Notes |
|---|---|---|
| **A** | **Apply to live as-is** | Genuinely low risk: 1-row table, widening cast, instant, and reversible while all values are whole numbers. This is about as safe as a live DDL gets |
| **B** | Upgrade Supabase to Pro first (CHECKLIST #3, a go-live blocker anyway) and dry-run on a branch | Buys a real rehearsal **and** backups, which the free tier does not have at all |
| **C** | Take a manual backup/export first, then apply | Middle ground without the upgrade |

**My recommendation: B if you were going to upgrade soon regardless** — the free tier keeps **zero
backups**, which is a worse exposure than this migration. Otherwise **C**. I would not choose A
purely because there is currently no backup of anything, not because this statement is dangerous.

---

## The existing `SaleItem` row — before, and predicted after

**BEFORE (live now):**

| id | saleId | productId | moduleKey | quantity | unitPrice | discountPercent | lineTotal | netLineTotal |
|---|---|---|---|---|---|---|---|---|
| `cmsjh3kly0004uve8zootrgoy` | `cmsjh3kly0002uve8ajkvs2ji` | `prod_buns` | `bakery` | **`100`** | `50.00` | `0.00` | `5000.00` | `5000.00` |

**PREDICTED AFTER** — only the middle column's representation changes:

| quantity | | |
|---|---|---|
| `100` → **`100.00`** | numerically identical | `100 × 50.00 = 5000.00` still reconciles exactly |

**This is a prediction, not an observation** — the migration has not run. Reconciling it for real is
the first thing to do once you give the go.

---

## Verification

| Check | Result |
|---|---|
| Database changed? | **NO** — `quantity` still `integer`, `productId` still `NOT NULL`, **7** migrations applied |
| Migration applied? | **NO** — `migrate status` lists it as pending |
| `tsc --noEmit` (4096) | **exit 0** |
| `next lint` | clean |
| `npm run build` | green |
| Newly failing typecheck | **none** |
| App code changed? | **NO** — the only tracked modification is `prisma/schema.prisma` |
| `/beverages/new-sale` | **200** |
| `/bakery/new-sale` | **200** |
| `/milk/sales` (milk sale dialog) | **200** |
| **Old sale path still records correctly** | Created a `ZZ_TEST_` beverage sale end to end: qty 3 × `275.50`, 10% line, 5% bill → `lineTotal 743.85`, `total 706.66` — **identical to before** |

### Data integrity

| | |
|---|---|
| `Product` | **27**, fingerprint `95794a0bb44f1b15d541a60ef0bd5c51` — **matches baseline** |
| `Customer` | **1** — `Saif` |
| `BakerySale` **Rs. 5,000** · `MilkSale` **Rs. 6,000** · `BeverageSale` 0 | unchanged |
| `SaleItem` | 1 row, `quantity 100`, `lineTotal 5000.00` — unchanged |
| `User` | 1 — `i228767@nu.edu.pk` |

All `ZZ_TEST_` rows removed; stock restored to 100. Farmer tables never queried or written this
turn.

---

## Constraint compliance

| Constraint | Status |
|---|---|
| Additive/widening only; no drops, no data migration, no sale-path code changes | ✅ one `ALTER … SET DATA TYPE` |
| Farmer code untouched (`Farmer`, `MilkDelivery`, `FarmerPurchase`, farmer libs/UI, `/api/milk/farmers/**`) | ✅ never opened |
| 2 real sales + Saif untouched | ✅ fingerprint verified; migration not applied |
| No Sale-path removal, no reporting repoint | ✅ |
| No dependency installs/removals | ✅ |
| Not applied to live before a dry-run | ✅ **stopped, awaiting your decision** |

---

## Uncommitted, staged and ready

```
 M prisma/schema.prisma                                              (quantity + moduleKey comment)
?? prisma/migrations/20260811120000_widen_saleitem_quantity/         (the SQL, unapplied)
```

⚠️ **The generated Prisma client currently reflects the pending schema** (`quantity: Decimal`) while
the database still has `integer`. That is inert — nothing reads `SaleItem` — but say the word and I
will revert both instead of leaving it staged.

**Nothing committed. Awaiting your go on option A, B or C.**
