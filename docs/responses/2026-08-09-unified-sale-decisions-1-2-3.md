# Unified cross-category sale — decisions 1–3, for your answers

**Date:** 2026-08-09
**Status:** ⏸️ **WAITING ON YOUR ANSWERS.** Schema untouched, no migration written or run, nothing committed.

The SQL below was generated against a **scratch copy** of the schema in a temp directory using
`prisma migrate diff`, which reads and writes nothing.

---

## ⚠️ Read this first — Decision 1 is bigger than it looks

The brief frames Decision 1 as *"how does a line know its module?"*. That is real, but it is the
second-order question. The first-order one is:

> **Per-module revenue is currently a SALE-level number, and after the merge it cannot be.**

Today `lib/reports.ts` computes it like this:

```sql
SELECT SUM("totalAmount") FROM "BeverageSale" WHERE "saleDate" >= … AND < …
SELECT SUM("totalAmount") FROM "BakerySale"   WHERE …
```

Beverage revenue is *the sum of whole bills*, and that works only because a bill is entirely one
module. A Rs. 1,000 mixed bill cannot be attributed to either module. **Every per-module figure
has to move from the sale level to the line level** — the summary, the trend, and the CSV export.
(Top products is already line-level and survives untouched.)

### And that exposes a genuine correctness trap

Line totals sum to the **subtotal**, not the bill total:

```
total = round(subtotal × (1 − billDiscount/100), 2)
```

So if per-module revenue becomes `Σ lineTotal`, then on any sale carrying a whole-bill discount
the module figures **overstate revenue**, and "beverages + bakery + milk" no longer equals total
revenue — the dashboard's central claim.

Concretely, with a 10% bill discount:

| | |
|---|---|
| Beverage lines | Rs. 600 |
| Bakery lines | Rs. 400 |
| Subtotal | Rs. 1,000 |
| **Bill total actually charged** | **Rs. 900** |
| Naive `Σ lineTotal` split | 600 + 400 = **Rs. 1,000** ❌ overstates by 100 |

Neither option (a) nor (b) in the brief addresses this — they are both about *identifying* a
line's module, not about *apportioning the bill discount* across modules. This would not throw an
error. It would quietly inflate revenue on every discounted sale, and only show up as the module
split failing to reconcile with the total.

**My recommendation: store an apportioned `netLineTotal` on each line.** Each line's share of the
bill discount is allocated pro-rata by `lineTotal`, rounded to 2dp, with the rounding residue
given to the largest line so the parts sum to the whole **exactly**. Then:

- module revenue = `Σ netLineTotal` filtered by module
- `Σ netLineTotal` over the whole sale = `totalAmount`, by construction
- the split always reconciles

It is one extra `Decimal(10,2)` column and one allocation function next to the existing discount
maths in `lib/sales.ts`. `lineTotal` stays as-is, so the bill still shows the owner what each line
cost before the bill discount.

---

## Decision 1 — how a line knows its module

### Recommendation: **(b) store `moduleKey` on the line at sale time.**

| | (a) derive from product category at report time | (b) store `moduleKey` on the line |
|---|---|---|
| Report query | joins SaleItem → Product → SubCategory → Category | filter one indexed column |
| History stability | **mutable** | **immutable** |
| Consistency with this codebase | breaks the pattern | matches it |

The deciding argument is not performance, it is **history**. The catalog lets the owner move a
product to a different sub-category. Under (a), doing that **silently re-attributes past sales**
between beverages and bakery — last month's closed numbers change because someone tidied the
catalog today.

That is precisely the class of bug this project has already ruled out twice, in writing:

- **Gotcha 5 / the price snapshot** — a line stores its own `unitPrice`; nothing re-joins to
  `Product.price` to value a historical line.
- **The discount rework** — a line stores its own `discountPercent`; reading the product's was
  called out as making an old bill mutable.

A line's *module* is the same kind of fact as its price and its discount: what it was sold as.
Option (b) is the consistent answer, and it happens to also be the faster one.

The cost of (b) is the usual denormalisation risk — `moduleKey` could disagree with the product's
current category. That is not drift, it is the snapshot doing its job, and it is the same
"risk" `unitPrice` already carries.

**This is the answer that keeps reports working**, with the module aggregation rewritten from
sale-level to line-level as described above.

---

## Decision 2 — the entry points

### Recommendation: **one "Sales" section, with a module filter on the list.**

| Today | Proposed |
|---|---|
| Nav: Beverages, Bakery | Nav: **Sales** |
| `/beverages/new-sale`, `/bakery/new-sale` | **`/sales/new`** — one form, any product |
| `/beverages`, `/bakery` lists | **`/sales`** with an All / Beverages / Bakery filter |
| — | `/beverages` and `/bakery` **redirect** to the filtered list |

Reasoning:

- The client's stated need is one bill across categories. Two "New sale" buttons means the owner
  must decide the module *before* knowing what the customer wants, and starting on the wrong one
  is a dead end — which is the exact friction this rework exists to remove.
- The module-filtered **views** keep their value: "what did bakery do this week" is a real
  question. So the filter survives even though the entry point merges.
- Redirecting the old routes keeps any bookmark or muscle memory working, and costs two tiny
  files.
- Milk stays exactly where it is. It has no products, no stock and its own screens; nothing here
  touches it.

### One Design System conflict to settle

CLAUDE.md says **never mix module accents on one screen**, with `/reports` as the deliberate
exception. A unified sale form is inherently mixed.

**Proposal:** the sale screens go **neutral zinc** for chrome and buttons, and module accents
appear only as the small per-line dot already used in the customer purchase history
(`MODULE_DOT_CLASS` in `lib/receivables-display.ts`). Colour then identifies the *line's* module
rather than the screen's, which is the same logic that makes the reports exception legitimate.
Say if you would rather keep an accent on the sale screens.

---

## Decision 3 — schema, migration, and Saif's row

### The data that exists

| | |
|---|---|
| `BeverageSale` / `BeverageSaleItem` | **0 / 0 rows** |
| `BakerySale` / `BakerySaleItem` | **1 / 1 row** |

The entire migration is **one sale and one line**:

```
BakerySale     cmsjh3kly0002uve8ajkvs2ji
               customer cmsjh19kt0000uve80ly9uxba (Saif)
               saleDate 2026-08-07 19:00:00   billDiscount 0.00   total 5000.00   notes NULL

BakerySaleItem cmsjh3kly0004uve8zootrgoy
               product prod_buns   qty 100   unitPrice 50.00   lineDiscount 0.00   lineTotal 5000.00
```

### Proposed schema

```prisma
model Sale {
  id              String     @id @default(cuid())
  customerId      String
  customer        Customer   @relation(fields: [customerId], references: [id])
  saleDate        DateTime   @default(now())
  discountPercent Decimal    @default(0) @db.Decimal(5, 2)
  totalAmount     Decimal    @db.Decimal(10, 2)
  notes           String?
  items           SaleItem[]
  createdAt       DateTime   @default(now())

  @@index([customerId, saleDate])
  @@index([saleDate])
}

model SaleItem {
  id              String  @id @default(cuid())
  saleId          String
  sale            Sale    @relation(fields: [saleId], references: [id], onDelete: Cascade)
  productId       String
  product         Product @relation(fields: [productId], references: [id])
  /// "beverages" | "bakery" — SNAPSHOT of the module at sale time (Decision 1).
  moduleKey       String
  quantity        Int
  unitPrice       Decimal @db.Decimal(10, 2)
  discountPercent Decimal @default(0) @db.Decimal(5, 2)
  lineTotal       Decimal @db.Decimal(10, 2)
  /// lineTotal minus this line's share of the whole-bill discount.
  netLineTotal    Decimal @db.Decimal(10, 2)

  @@index([saleId])
  @@index([productId])
  @@index([moduleKey])
}
```

Validated with `prisma validate` — the schema is valid, including the required back-relations on
`Customer` (`sales Sale[]`) and `Product` (`saleItems SaleItem[]`).

### ⚠️ The auto-generated migration is NOT safe to run. Two defects.

`prisma migrate diff` produced this, and it must not be used as-is:

```sql
DROP TABLE "BakerySale";        -- ← before the new tables exist
DROP TABLE "BakerySaleItem";
DROP TABLE "BeverageSale";
DROP TABLE "BeverageSaleItem";
CREATE TABLE "Sale" ( … );
CREATE TABLE "SaleItem" ( … );
```

**Defect 1 — it drops first and creates second.** Prisma has no idea the data should move; it
sees tables removed from the schema. Run verbatim, **Saif's sale is gone**, and the "no sale
history is lost" requirement fails on the only sale that exists.

**Defect 2 — no RLS on the new tables.** CLAUDE.md is explicit: Prisma does not manage RLS, so
every migration that adds a table must also `ENABLE ROW LEVEL SECURITY`, or the table is exposed
through PostgREST with the public anon key. The generated SQL has no such statement. This is the
documented trap and the generator walks straight into it.

### The migration I would actually run — hand-ordered, in two parts

**Migration A — create, copy, secure. Nothing destructive.**

```sql
-- 1. New tables (bodies exactly as generated above), then:
ALTER TABLE "Sale"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem" ENABLE ROW LEVEL SECURITY;   -- CLAUDE.md: required, zero policies

-- 2. Copy every sale, keeping ORIGINAL IDs so nothing that references
--    a sale id breaks and the migration is re-runnable/comparable.
INSERT INTO "Sale" (id,"customerId","saleDate","discountPercent","totalAmount",notes,"createdAt")
SELECT id,"customerId","saleDate","discountPercent","totalAmount",notes,"createdAt" FROM "BeverageSale";
INSERT INTO "Sale" (id,"customerId","saleDate","discountPercent","totalAmount",notes,"createdAt")
SELECT id,"customerId","saleDate","discountPercent","totalAmount",notes,"createdAt" FROM "BakerySale";

-- 3. Copy the lines, stamping moduleKey and back-filling netLineTotal.
--    Existing sales all have a 0% bill discount, so netLineTotal = lineTotal
--    for every migrated row — but it is computed, not assumed, so a non-zero
--    bill discount would still migrate correctly.
INSERT INTO "SaleItem" (id,"saleId","productId","moduleKey",quantity,"unitPrice","discountPercent","lineTotal","netLineTotal")
SELECT i.id,i."saleId",i."productId",'beverages',i.quantity,i."unitPrice",i."discountPercent",i."lineTotal",
       ROUND(i."lineTotal" * (1 - s."discountPercent"/100), 2)
FROM "BeverageSaleItem" i JOIN "BeverageSale" s ON s.id = i."saleId";
INSERT INTO "SaleItem" (id,"saleId","productId","moduleKey",quantity,"unitPrice","discountPercent","lineTotal","netLineTotal")
SELECT i.id,i."saleId",i."productId",'bakery',i.quantity,i."unitPrice",i."discountPercent",i."lineTotal",
       ROUND(i."lineTotal" * (1 - s."discountPercent"/100), 2)
FROM "BakerySaleItem" i JOIN "BakerySale" s ON s.id = i."saleId";

-- 4. Assert the copy is complete, or roll the whole thing back.
DO $$
DECLARE old_sales int; new_sales int; old_items int; new_items int;
BEGIN
  SELECT (SELECT COUNT(*) FROM "BeverageSale") + (SELECT COUNT(*) FROM "BakerySale") INTO old_sales;
  SELECT (SELECT COUNT(*) FROM "BeverageSaleItem") + (SELECT COUNT(*) FROM "BakerySaleItem") INTO old_items;
  SELECT COUNT(*) FROM "Sale"     INTO new_sales;
  SELECT COUNT(*) FROM "SaleItem" INTO new_items;
  IF old_sales <> new_sales OR old_items <> new_items THEN
    RAISE EXCEPTION 'ABORT: copied %/% sales and %/% items', new_sales, old_sales, new_items, old_items;
  END IF;
END $$;
```

**Migration B — drop the old tables. Separate, and only after the new flow is browser-verified.**

### Recommendation on the old tables: **migrate, keep briefly, then drop in Migration B**

Not "keep dormant" like `CustomerPayment`, and not dropped in the same migration as the copy.

- **Not dormant forever.** `CustomerPayment` is kept because receivables might genuinely come
  back. Nothing brings per-module sale tables back — they are strictly superseded. Leaving them
  populated means two sources of sale history, and a bug that writes to the old one would be
  invisible rather than an error.
- **Not dropped in Migration A.** Two destructive things in one migration is one too many — the
  same reasoning that split the `Product.discountPercent` drop out of the discount rework. Copy,
  verify against the live DB, run the app, *then* drop, with the old rows still sitting there as a
  rollback if the copy turns out wrong.

So: after Migration A, Saif's sale exists in **both** shapes; the code reads only the new one; and
Migration B removes the old tables once you have seen the new flow work.

### Saif's row, before and after

| | Before (`BakerySale`) | After (`Sale`) |
|---|---|---|
| id | `cmsjh3kly0002uve8ajkvs2ji` | **same** |
| customer | Saif | same |
| saleDate | 2026-08-07 19:00:00 | same |
| bill discount | 0.00 | same |
| total | **5000.00** | **5000.00** |
| line | Buns ×100 @ 50.00, lineTotal 5000.00 | same, **+ `moduleKey='bakery'`, `netLineTotal=5000.00`** |

Ids are preserved, so the sale keeps its identity and nothing referencing it can dangle.

---

## What I need from you

1. **Decision 1** — confirm **(b) `moduleKey` on the line**, *and* confirm the `netLineTotal`
   apportionment. The second half is the one I would most like you to look at, since it is not in
   the brief and it changes the schema.
2. **Decision 2** — confirm the single `/sales` section with a module filter and redirects, and
   the neutral-accent proposal for the sale screens.
3. **Decision 3** — confirm the schema, the two-part hand-ordered migration, and keeping the old
   tables until a follow-up Migration B.

Once you answer, I will show you the final migration files and **wait again for the explicit go**
before running anything, exactly as with the discount delete and stock.

---

### Source used

**Context7: attempted, still not connecting — 9th consecutive session.** Installed-source fallback
per the CLAUDE.md rule:

- The migration SQL above was **generated by the installed Prisma 6 CLI** (`migrate diff` against
  the live datasource), which is how both defects were caught rather than assumed.
- The proposed schema was checked with `prisma validate` against the same CLI.
- The current table shapes and row counts were read from the **live database**, not inferred.
