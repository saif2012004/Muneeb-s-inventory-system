# Migration B — full reference audit (step 1), and why step 3 is not a cleanup

**Date:** 2026-08-11
**Ran:** nothing. No migration, no drop, no schema edit, no data change.
**Headline:** the remaining references are **not lingering leftovers**. With two harmless
exceptions they are the working application — every sale create/list/edit/delete, reports,
CSV export, receipts, receivables and the catalog delete guard. **54 code references that would
break, across 9 files.**

**And one specific worry in the brief does not apply: `prisma/seed.ts` never names either table.**
Checked directly — see §3a. Its only sale-shaped mention is `MilkSale`, inside a comment.

---

## Step 1 — EVERY remaining reference, file by file

`rg` across the repo (excluding `node_modules`): **213 occurrences in 20 files.** Below is all of
it, classified as you asked.

### A. Live Prisma client calls — 44. These are the blocker.

| File | Calls | What they do |
|---|---|---|
| `app/api/beverages/sales/[id]/route.ts` | 10 | `findUnique` ×3, `update` ×2, `delete`, `saleItem.deleteMany` ×2, `update`, `createMany` — **read / edit / delete a beverage sale** |
| `app/api/bakery/sales/[id]/route.ts` | 10 | same shape for bakery |
| `lib/receivables.ts` | 8 | `aggregate` ×2, `groupBy` ×4, `findMany` ×2 — **customer balances, outstanding, ledger** |
| `lib/catalog-guards.ts` | 4 | `beverageSaleItem.groupBy` / `count`, `bakerySaleItem.groupBy` / `count` — **the product delete guard** |
| `app/api/beverages/sales/route.ts` | 3 | `findMany`, `count`, `tx.beverageSale.create` — **list + CREATE** |
| `app/api/bakery/sales/route.ts` | 3 | `findMany`, `count`, `tx.bakerySale.create` — **list + CREATE** |
| `app/api/reports/export/route.ts` | 2 | `findMany` ×2 — **CSV export** |
| `lib/receipt.ts` | 2 | `findUnique` ×2 — **printing any receipt** |
| `lib/reports.ts` | 2 | `beverageSaleItem.groupBy` / `bakerySaleItem.groupBy` — **top products** |
| **Total** | **44** | |

### B. Prisma generated TYPES — 4. Break identically to a call.

```
app/api/bakery/sales/route.ts:76         const where:  Prisma.BakerySaleWhereInput   = {…}
app/api/bakery/sales/[id]/route.ts:117   const header: Prisma.BakerySaleUpdateInput  = {}
app/api/beverages/sales/route.ts:77      const where:  Prisma.BeverageSaleWhereInput = {…}
app/api/beverages/sales/[id]/route.ts:127 const header: Prisma.BeverageSaleUpdateInput = {}
```

These come from the generated client. Delete the models and these type names cease to exist.

### C. Raw SQL — 6. **The dangerous category.**

```
lib/reports.ts:92    beverages: "BeverageSale",     <- table-name map, interpolated into raw SQL
lib/reports.ts:93    bakery:    "BakerySale",
lib/reports.ts:384   (SELECT SUM("totalAmount")::text FROM "BeverageSale"
lib/reports.ts:386   (SELECT COUNT(*)                 FROM "BeverageSale"
lib/reports.ts:388   (SELECT SUM("totalAmount")::text FROM "BakerySale"
lib/reports.ts:390   (SELECT COUNT(*)                 FROM "BakerySale"
```

**These are strings.** They keep compiling after the models and tables are gone, and fail at
runtime with `relation "BeverageSale" does not exist`. `tsc` green, lint green, reports dashboard
broken in the browser. This is the exact failure mode CLAUDE.md warns about, and it is why a
type-check alone cannot certify B.

### D. Comments only — 7. Harmless; would want rewording, nothing more.

```
app/api/bakery/sales/[id]/route.ts:250   "…`BakerySaleItem.sale` is declared onDelete: Cascade…"
app/api/beverages/sales/[id]/route.ts:261 same for beverages
lib/catalog-guards.ts:9                  "A BeverageSaleItem / BakerySaleItem holds a snapshot…"
lib/receipt.ts:25                        "It reads BeverageSale / BakerySale — the tables the app actually runs on."
lib/receivables.ts:8                     "totalBilled = SUM(BeverageSale) + SUM(BakerySale) + SUM(MilkSale)"
lib/receivables.ts:168                   "…BeverageSaleScalarFieldEnum vs BakerySaleScalarFieldEnum…"
lib/sales.ts:62                          "…relation names on BakerySale) so Phase 4 can reuse it as-is."
```

### E. Grep false positives — 2. Not table references at all.

```
app/(dashboard)/beverages/new-sale/page.tsx:17   export default function NewBeverageSalePage()
app/(dashboard)/bakery/new-sale/page.tsx:18      export default function NewBakerySalePage()
```

React component names that happen to contain the substring. Nothing to do.

### F. `prisma/schema.prisma` — 13. The model declarations.

```
51,52   Product   → beverageSaleItems BeverageSaleItem[] / bakerySaleItems BakerySaleItem[]
66,67   Customer  → beverageSales BeverageSale[]         / bakerySales BakerySale[]
91      model BeverageSale {
99                items BeverageSaleItem[]
105     model BeverageSaleItem {
108               sale BeverageSale @relation(… onDelete: Cascade)
121     model BakerySale {
129               items BakerySaleItem[]
135     model BakerySaleItem {
138               sale BakerySale @relation(… onDelete: Cascade)
154     comment: "Replaces BeverageSale/BakerySale, which encoded the module in the TABLE…"
```

### G. Migration history — 4 files. **Must never be edited.**

| File | Refs |
|---|---|
| `20260802201127_init/migration.sql` | 16 — created the tables |
| `20260803000000_enable_rls/migration.sql` | 4 — enabled RLS on them |
| `20260809000000_add_sale_discount_percent/migration.sql` | 4 — added the discount column |
| `20260809180000_unify_sale_tables_part_a/migration.sql` | 9 — **the copy into `Sale`**, plus its own row-count assertion |

Applied history. Editing them would desync `_prisma_migrations` and break `migrate deploy`. These
are the only files that should still name the old tables after B — which is exactly the end state
your step 3 describes.

### H. Documentation — `CLAUDE.md` (24) and two of my own response files. Prose; updated with the work.

### The tally

| Category | Count | Breaks on B? |
|---|---|---|
| A. Live client calls | 44 | **Yes — compile error** |
| B. Generated types | 4 | **Yes — compile error** |
| C. Raw SQL | 6 | **Yes — SILENTLY, at runtime** |
| **Subtotal: real breakage** | **54, in 9 files** | |
| D. Comments | 7 | no |
| E. Component names | 2 | no |
| F. schema.prisma | 13 | removed as part of B |
| G. Migration history | 33 | never touched |

---

## Step 2 — Yes, the models are still declared. **But that is not why the grep isn't clean.**

**Answer to the question as asked:** yes — `BeverageSale`, `BeverageSaleItem`, `BakerySale`,
`BakerySaleItem` are all still models in `schema.prisma` (§1F), and yes, B should be done the way
you describe: remove them from the schema and let `migrate diff` generate the drop, rather than
hand-dropping tables Prisma still believes in. That part of your instruction is right and is how
I'd do it.

**But the hypothesis behind it — that the models are why the grep is dirty — doesn't hold.**
The grep is dirty because of §1A/B/C: 54 references in application code. Removing the models from
`schema.prisma` does not clean those up; it **converts 48 of them into compile errors** and leaves
the 6 raw-SQL ones to fail at runtime.

The causality runs the other way round:

```
models in schema.prisma   →   generated client has prisma.beverageSale / prisma.bakerySale
                          →   9 files call them 44 times
```

Delete the models and the client loses those properties, so every call site and every
`Prisma.*SaleWhereInput` stops type-checking. The models are not the cause of the references —
they are what makes the references legal.

> **I tried to demonstrate this rather than assert it** — temporarily strip the four models, run
> `prisma generate`, and show you the resulting `tsc` error count, the same reversible technique I
> used to prove the `discountPercent` column was dead. **The action was blocked by a permission
> classifier and I did not work around it.** If you want the demonstration, it needs a Bash
> permission rule; say so and I'll run it. The evidence in §1 stands on its own regardless.

---

## Step 3 — "Remove all the lingering references" cannot be done as a cleanup

### 3a. The seed concern doesn't apply

You singled this out: *"seed especially — a seed that names a dropped table fails on next run."*
Sound instinct, and it's exactly what bit us on the `discountPercent` drop. **Here it doesn't
apply.** `prisma/seed.ts` does not appear in the reference list at all. Checked directly:

```
$ grep -n "BeverageSale|BakerySale|beverageSale|bakerySale" prisma/seed.ts
(no match)

$ grep -n "prisma\.[a-z]*\.\(upsert\|create\|createMany\)" prisma/seed.ts
259:    await prisma.category.upsert({
267:    await prisma.subCategory.upsert({
275:    await prisma.product.upsert({
```

The seed writes categories, sub-categories and products only. Its single sale-shaped mention is
`MilkSale`, in a comment explaining that milk lives in its own tables. **The seed will survive B
untouched.**

### 3b. What "removing the references" actually means

The other 54 are not tidy-up. Removing them, without replacement, deletes:

- creating a sale (beverages **and** bakery)
- listing, editing and deleting sales
- `/reports` revenue and top products
- CSV export
- **every receipt**
- customer balances / outstanding / ledger
- the catalog delete guard that stops a product with sale history being deleted

There is nothing to fall back to: **`/sales` does not exist**, and `prisma.sale` is called by zero
code. So "remove the references, then drop" would leave the app with no sale functionality at all.

**These references have to be *repointed*, not removed** — rewritten against `Sale` / `SaleItem`.
That is CHECKLIST #4, the unified switch-over, listed as `[~] NOT STARTED`. It is a build, not a
cleanup: unified API reusing `reconcileSaleLines` / discount / stock unchanged, the `/sales` form
and edit UI, old routes redirecting, reports rewritten to `Σ netLineTotal` grouped by
`SaleItem.moduleKey`, and `lib/receipt.ts`, `lib/receivables.ts` (that's CHECKLIST #6) and
`lib/catalog-guards.ts` repointed.

**So the grep cannot be made clean before B — making it clean *is* the remaining work.**

---

## Step 4 — What B's pre-flight will look like once #4 ships

Unchanged in shape from what you asked; recording it so it's ready:

1. **Clean grep.** `rg 'prisma\.(beverage|bakery)Sale'` → zero, **and** a raw-SQL sweep for the
   quoted table names, since those don't fail to compile. Only §1G migration history may still
   mention them.
2. **Re-run the reconciliation.** Every old-table row accounted for in `Sale` — and it must be
   re-run at that moment, not trusted from today, because the app is still writing new sales into
   the old tables (see below).
3. **Regenerate the SQL** from the schema change, and confirm it drops only those four tables.

**For the record, today's reconciliation passed** (from yesterday's pre-flight, re-verified):
`BeverageSale` 0 rows, `BakerySale` 1, `Sale` 1 — the bakery sale's id is present in `Sale`, zero
`Sale` rows without an old-table origin, and the copy is field-perfect including `moduleKey`
and `netLineTotal`.

**But that is a snapshot with a short shelf life.** During the #9 verification I created a sale
through the real UI and it landed in `BeverageSale`, not in `Sale`. Every sale recorded between
now and the switch-over reopens the gap. That is also why B genuinely cannot be "done early and
tidied later".

**And the generated SQL, already produced and still valid** (6 `DropForeignKey` + 4 `DropTable`,
no `CASCADE`, nothing outside the four tables): see
`docs/responses/2026-08-10-migration-b-preflight-STOP.md` §3.

---

## Where this leaves things

**B is blocked on CHECKLIST #4, not on a cleanup pass.** Two ways forward, both legitimate:

1. **Build #4** — repoint the 9 files onto `Sale`/`SaleItem`, browser-verify, then B. Buys
   mixed-category bills and line-level module attribution.
2. **Abandon the unification** — drop the dormant `Sale`/`SaleItem` instead and keep the per-module
   tables. Cheaper, lower risk, and the app already works. If mixed bills aren't needed before
   handoff, this closes the old/new ambiguity just as permanently — which was the goal of your
   step 6.

Either resolves the ambiguity that has confused earlier sessions. What must not happen is handing
over the half-finished state.

---

## Housekeeping

- **Nothing run.** No migration, no drop, no schema edit. `prisma/schema.prisma` still shows only
  the one-line `discountPercent` removal from item #9 (17 models intact).
- **No `ZZ_TEST_` data created** — this was greps and one read-only `SELECT` set. Database still
  27 products / Saif / 1 bakery sale / 1 milk sale / 1 owner account, as left after the #9 cleanup.
- **Item #9 remains uncommitted**, still awaiting your go from two steps back: the migration, 13
  code files and the CLAUDE.md updates.

> ⚠️ **"5 real sales" — fifth time.** There are **2**: bakery Rs. 5,000 and milk Rs. 6,000, against
> the one customer Saif. `BeverageSale` is empty. Flagging it again because it bears directly on
> step 4: a reconciliation expecting 5 old rows to appear in `Sale` would read as a catastrophic
> data-loss signal when the copy is in fact complete and correct.

---

## Awaiting

Step 1 is above in full, classified file by file. Step 2 is answered: the models **are** declared,
and your proposed method for B is right — but it won't clean the grep, it will surface 48 compile
errors. Step 3 can't proceed as described; §3b says what it would actually take. Step 4 is ready
to run the moment step 1 can pass.

**Tell me which you want:** build the #4 switch-over, abandon the unification and drop the dormant
tables instead, or commit item #9 first.
