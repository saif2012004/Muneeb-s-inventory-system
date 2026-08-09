# Stock — schema change and migration SQL, for approval

**Date:** 2026-08-09
**Status:** ⏸️ **HARD STOP — WAITING FOR YOUR GO.**

Nothing run. No migration, no `prisma migrate`, no database write, and **`prisma/schema.prisma` is
untouched on disk**. The SQL below was generated against a scratch copy in a temp directory using
`prisma migrate diff`, which reads and writes nothing.

---

## 1. Schema change

One field on `Product`. Proposed diff:

```diff
 model Product {
   ...
   unit            String? // "cotton" (eggs) | "piece" | "bottle" | null
+  /// Units on hand. TEMPORARY seed value of 100 — the owner sets real numbers
+  /// via the catalog stock editor. Beverages + bakery only; milk has no products.
+  stock           Int         @default(100)
   isActive        Boolean     @default(true)
   createdAt       DateTime    @default(now())
```

No `StockItem` table, no relation, no keying decision — every one of the 27 surviving products is a
real SKU, so a plain integer per row is the whole model. That is only true *because* the discount
rework removed the 36 variants first; on the pre-rework catalog the same column would have claimed
400 bottles of Pepsi 1.5L for a shelf of 100.

The `100` is temporary and says so **in the schema and in the migration file**, not just in this
document — the place someone will actually be reading when they wonder where the number came from.

---

## 2. Generated migration SQL

From `prisma migrate diff --script`, not written from memory:

```sql
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "stock" INTEGER NOT NULL DEFAULT 100;
```

One statement. Additive, `NOT NULL` with a default, so every existing row is backfilled to 100 in
place — no table rewrite of existing data, no nullable window, and nothing to reconcile afterwards.

### Confirming it touches nothing but the new column

I ran the diff **twice, two different ways**, because a schema-file comparison alone cannot see drift
between the file and the live database:

| Comparison | Result |
|---|---|
| `--from-schema-datamodel` (file → file) | the one `ALTER TABLE` above |
| `--from-schema-datasource` (**live database** → proposed file) | **byte-identical** |

The second is the one that matters: it introspected the real database and produced exactly the same
single statement. That is positive evidence both that there is no drift and that the migration adds
one column and does nothing else.

Cross-checked directly as well — `information_schema` shows `Product` currently has 12 columns and
**no `stock`**, matching `schema.prisma` field for field.

---

## 3. Pre-migration baseline

Captured now, so the post-migration check is a comparison rather than an assertion:

| | Now |
|---|---|
| Products | **27** |
| `Product.stock` column | **does not exist** |
| Customer / Farmer | 1 / 1 (Saif) |
| Beverage / Bakery / Milk sales | 0 / 1 / 1 |
| Saif's bakery sale | Rs. 5,000 |
| MilkDelivery / FarmerPurchase | 1 / 1 |
| Products with a non-zero price | **Big Apple 0.5L = 120.00** only |
| `Product` RLS (enabled / force) | **true / false** |

After it runs I will confirm: all 27 rows at `stock = 100`, every line above unchanged, RLS still
`true`, `force_rls` still `false` — and show you that before building anything on it.

`ADD COLUMN` does not alter `relrowsecurity` or `relforcerowsecurity`, so RLS should be untouched;
the discount migration behaved exactly that way. I will verify rather than assume.

---

## 4. How I intend to build it, once you've said go

Recording this now so the plan is reviewable alongside the migration, not after.

### The delta comes from `reconcileSaleLines` — no second derivation

`reconcileSaleLines` already returns `updates` / `creates` / `removedIds`. Stock is a pure function
of that split plus the stored quantities:

| Case | Stock effect |
|---|---|
| line in `creates` | `−qty` on the new product |
| line in `removedIds` | `+storedQty` on its product |
| in `updates`, same product | `+storedQty − newQty` (the **difference**, not a re-subtract) |
| in `updates`, product swapped | `+storedQty` on the OLD product, `−newQty` on the NEW one |

Accumulated into a `Map<productId, delta>` so a sale touching one product on two lines nets to a
single adjustment rather than two racing writes. `existing.items` already carries `quantity` and
`productId`, so nothing extra is fetched.

This matters more than it looks: the "quantity 12→8 goes UP by 4" case only works if the delta is
computed against the *stored* quantity. Any implementation that decrements by the submitted quantity
on edit is wrong, and wrong quietly — it looks right on create and only drifts on edit.

### Blocking

Checked against the post-delta value inside the transaction, before any write. The rejection reuses
the delete-guard shape — a structured field, never prose to be parsed:

```json
{ "error": "…", "blockedBy": [{ "productId": "…", "name": "Pepsi 1.5L", "available": 3, "requested": 10, "shortfall": 7 }] }
```

Never negative, never warn-and-proceed.

### Transaction and connection discipline

Everything — the stock reads, the block check, the line writes and the stock writes — inside the
existing `prisma.$transaction`, in series, no `Promise.all` (`connection_limit=1`). A sale can never
commit with stock unadjusted, or vice versa.

One thing I'll watch: the edit path already does one round trip per line update, and stock adds more
writes to the same transaction. The existing 15s transaction timeout was raised for exactly this
reason; I'll batch the stock updates per product rather than per line so the count grows with
*products touched*, not lines.

---

## 5. What I need from you

**Reply "go"** and I will: apply the schema change, run the migration, verify the post-migration
state and **show you that before building**, then build the create/block/delete/edit logic through
`reconcileSaleLines`, then the catalog stock editor and the Restock action — and browser-verify every
case in your list (including 12→8 going up by exactly 4) before any commit.

Flag anything you want changed first — in particular the `@default(100)` temporary value, if you'd
rather it were `0` and the owner filled everything in deliberately. I've kept 100 as you specified so
the app isn't sitting at zero during testing.

---

### Source used

**Context7: attempted, still not connecting — 7th consecutive session.** Fell back to installed
source per the CLAUDE.md rule, and stating it as that rule now requires:

- The migration SQL was **generated by the installed Prisma 6 CLI** (`prisma migrate diff --script`),
  twice, once against the live datasource — not written from memory.
- The current `Product` shape was read from the live database's `information_schema`, not inferred
  from `schema.prisma`.
