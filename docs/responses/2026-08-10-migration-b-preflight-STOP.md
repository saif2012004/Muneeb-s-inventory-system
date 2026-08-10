# Migration B pre-flight — **STOP. Step 1 fails.**

**Date:** 2026-08-10
**Verdict:** **DO NOT RUN MIGRATION B.** Nothing was run. No schema file was modified for this.
**Reason:** step 1's own stop condition is met — *"If ANY live code path still queries them, STOP."*
**Every sale, report, receipt and receivable in the app queries the old tables. 50 references
across 9 files.** The unified `Sale`/`SaleItem` tables are queried by **nothing**.

Running B today would not migrate the app off the old tables. It would delete the tables the
running app depends on, and the app would fail on the dashboard, both sale modules, reports,
receipts, the customers hub, and the catalog delete-guard.

Steps 2 and 3 both pass on their own terms, and I've done them in full below — but they are
irrelevant while step 1 fails, and I want you to see exactly why.

---

## Step 1 — Prove nothing reads the old tables. **IT FAILS.**

### 1a. Prisma client access — 44 live call sites

```
app/api/bakery/sales/route.ts:85          prisma.bakerySale.findMany({
app/api/bakery/sales/route.ts:92          prisma.bakerySale.count({ where }),
app/api/bakery/sales/route.ts:205         return tx.bakerySale.create({
app/api/bakery/sales/[id]/route.ts:52     const sale = await prisma.bakerySale.findUnique({
app/api/bakery/sales/[id]/route.ts:95     const existing = await prisma.bakerySale.findUnique({
app/api/bakery/sales/[id]/route.ts:143    const sale = await prisma.bakerySale.update({
app/api/bakery/sales/[id]/route.ts:209    await tx.bakerySaleItem.deleteMany({
app/api/bakery/sales/[id]/route.ts:216    await tx.bakerySaleItem.update({ where: { id }, data });
app/api/bakery/sales/[id]/route.ts:220    await tx.bakerySaleItem.createMany({
app/api/bakery/sales/[id]/route.ts:226    return tx.bakerySale.update({
app/api/bakery/sales/[id]/route.ts:264    const sale = await prisma.bakerySale.findUnique({
app/api/bakery/sales/[id]/route.ts:295    await tx.bakerySaleItem.deleteMany({ where: { saleId: sale.id } });
app/api/bakery/sales/[id]/route.ts:296    await tx.bakerySale.delete({ where: { id: sale.id } });
app/api/beverages/sales/route.ts:86       prisma.beverageSale.findMany({
app/api/beverages/sales/route.ts:93       prisma.beverageSale.count({ where }),
app/api/beverages/sales/route.ts:207      return tx.beverageSale.create({
app/api/beverages/sales/[id]/route.ts:51  const sale = await prisma.beverageSale.findUnique({
app/api/beverages/sales/[id]/route.ts:108 const existing = await prisma.beverageSale.findUnique({
app/api/beverages/sales/[id]/route.ts:153 const sale = await prisma.beverageSale.update({
app/api/beverages/sales/[id]/route.ts:220 await tx.beverageSaleItem.deleteMany({
app/api/beverages/sales/[id]/route.ts:227 await tx.beverageSaleItem.update({ where: { id }, data });
app/api/beverages/sales/[id]/route.ts:231 await tx.beverageSaleItem.createMany({
app/api/beverages/sales/[id]/route.ts:237 return tx.beverageSale.update({
app/api/beverages/sales/[id]/route.ts:275 const sale = await prisma.beverageSale.findUnique({
app/api/beverages/sales/[id]/route.ts:306 await tx.beverageSaleItem.deleteMany({ where: { saleId: sale.id } });
app/api/beverages/sales/[id]/route.ts:307 await tx.beverageSale.delete({ where: { id: sale.id } });
app/api/reports/export/route.ts:131       const sales = await prisma.beverageSale.findMany({
app/api/reports/export/route.ts:156       const sales = await prisma.bakerySale.findMany({
lib/catalog-guards.ts:48                  prisma.beverageSaleItem.groupBy({
lib/catalog-guards.ts:53                  prisma.bakerySaleItem.groupBy({
lib/catalog-guards.ts:86                  prisma.beverageSaleItem.count({ where: { productId } }),
lib/catalog-guards.ts:87                  prisma.bakerySaleItem.count({ where: { productId } }),
lib/receipt.ts:124                        ? await prisma.beverageSale.findUnique({
lib/receipt.ts:128                        : await prisma.bakerySale.findUnique({
lib/receivables.ts:106                    const beverage = await prisma.beverageSale.aggregate({ where, ...money });
lib/receivables.ts:107                    const bakery   = await prisma.bakerySale.aggregate({ where, ...money });
lib/receivables.ts:173                    const beverage = await prisma.beverageSale.groupBy({
lib/receivables.ts:179                    const bakery   = await prisma.bakerySale.groupBy({
lib/receivables.ts:250                    const beverage = await prisma.beverageSale.groupBy({ by: ["customerId"], ...money });
lib/receivables.ts:251                    const bakery   = await prisma.bakerySale.groupBy({ by: ["customerId"], ...money });
lib/receivables.ts:334                    const beverage = await prisma.beverageSale.findMany({ where, select: saleSelect });
lib/receivables.ts:335                    const bakery   = await prisma.bakerySale.findMany({ where, select: saleSelect });
lib/reports.ts:217                        ? await prisma.beverageSaleItem.groupBy({
lib/reports.ts:224                        : await prisma.bakerySaleItem.groupBy({
```

### 1b. Raw SQL against the old tables — 6 more, and these are the nastiest

```
lib/reports.ts:92    beverages: "BeverageSale",
lib/reports.ts:93    bakery:    "BakerySale",
lib/reports.ts:384   (SELECT SUM("totalAmount")::text FROM "BeverageSale"
lib/reports.ts:386   (SELECT COUNT(*)                 FROM "BeverageSale"
lib/reports.ts:388   (SELECT SUM("totalAmount")::text FROM "BakerySale"
lib/reports.ts:390   (SELECT COUNT(*)                 FROM "BakerySale"
```

**These would not be caught by `tsc`.** Lines 92–93 are a table-name map interpolated into raw SQL;
384–390 are literal table names in a raw query. After B they compile perfectly and fail at runtime
with `relation "BeverageSale" does not exist` — the reports dashboard breaking in the browser
while every check you have stays green. That is exactly the failure mode CLAUDE.md warns about.

### 1c. Classification, as you asked — (a) migration file, (b) dormant, or (c) gone

**None of the 50 falls into any of those three categories. All are live.**

| File | Refs | What breaks after B | Category |
|---|---|---|---|
| `app/api/beverages/sales/[id]/route.ts` | 10 | read / edit / delete a beverage sale | **LIVE** |
| `app/api/bakery/sales/[id]/route.ts` | 10 | read / edit / delete a bakery sale | **LIVE** |
| `lib/reports.ts` | 8 | `/reports` revenue + top products — **4 via raw SQL** | **LIVE** |
| `lib/receivables.ts` | 8 | customer balances, outstanding, ledger | **LIVE** |
| `lib/catalog-guards.ts` | 4 | the delete guard — deleting a product with sale history | **LIVE** |
| `app/api/beverages/sales/route.ts` | 3 | list + **create** a beverage sale | **LIVE** |
| `app/api/bakery/sales/route.ts` | 3 | list + **create** a bakery sale | **LIVE** |
| `lib/receipt.ts` | 2 | **printing any receipt** | **LIVE** |
| `app/api/reports/export/route.ts` | 2 | CSV export | **LIVE** |
| **9 files** | **50** | | |

### 1d. And the counterpart check: what uses the unified `Sale`/`SaleItem`?

```bash
grep -rn 'prisma\.sale\.|prisma\.saleItem\.|tx\.sale\.|tx\.saleItem\.|"Sale"|"SaleItem"' app lib components scripts
```

**One hit, and it is not a query:**

```
components/receipt/ReceiptDocument.tsx:101   lines.push(...metaRow("Sale", receipt.saleId.slice(-8)…))
```

That is the word "Sale" as a printed label on the receipt. **Zero code reads or writes the unified
tables.**

> ### ⚠️ The brief's premise is inverted
> The instruction describes the old tables as persisting *"ONLY as the pre-Migration-B rollback"*.
> They are not the rollback — **they are the live data model.** The unified tables are the dormant
> ones. This is CHECKLIST #4, still `[~] NOT STARTED`: Migration A copied the data, and the
> application was never switched over. I flagged this at session kickoff; the greps above are the
> same check CLAUDE.md prescribes, re-run today.

**→ Step 1's stop condition applies. B does not run until the switch-over (#4) is built and
browser-verified.**

---

## Step 2 — Is the data safe to lose from the old tables? **Yes. This part passes.**

Done anyway, because you're right that this is the last clean moment to check.

### Row reconciliation

| | rows |
|---|---|
| `BeverageSale` | **0** |
| `BeverageSaleItem` | **0** |
| `BakerySale` | **1** |
| `BakerySaleItem` | **1** |
| `Sale` (unified) | **1** |
| `SaleItem` (unified) | **1** |

| Reconciliation check | Result |
|---|---|
| Bakery sale ids present in `Sale` | **1 of 1** ✓ |
| Beverage sale ids present in `Sale` | **0 of 0** ✓ |
| `Sale` rows with **no** old-table origin | **0** ✓ |

They fully account for each other — no orphan either direction.

### Field-by-field, since row counts alone prove little

**Header:**

| Field | `BakerySale` (old) | `Sale` (unified) |
|---|---|---|
| `id` | `cmsjh3kly0002uve8ajkvs2ji` | `cmsjh3kly0002uve8ajkvs2ji` |
| `customerId` | `cmsjh19kt0000uve80ly9uxba` | `cmsjh19kt0000uve80ly9uxba` |
| `saleDate` | `2026-08-07 19:00:00` | `2026-08-07 19:00:00` |
| `discountPercent` | `0.00` | `0.00` |
| `totalAmount` | `5000.00` | `5000.00` |
| `notes` | null | null |
| `createdAt` | `2026-08-07 21:44:53.014` | `2026-08-07 21:44:53.014` |

**Line:**

| Field | `BakerySaleItem` (old) | `SaleItem` (unified) |
|---|---|---|
| `id` | `cmsjh3kly0004uve8zootrgoy` | `cmsjh3kly0004uve8zootrgoy` |
| `saleId` / `productId` | `…2ji` / `prod_buns` | `…2ji` / `prod_buns` |
| `quantity` · `unitPrice` | 100 · `50.00` | 100 · `50.00` |
| `discountPercent` · `lineTotal` | `0.00` · `5000.00` | `0.00` · `5000.00` |
| `moduleKey` | — | **`bakery`** ✓ correctly derived |
| `netLineTotal` | — | **`5000.00`** ✓ correctly apportioned |

**Migration A's copy is complete and faithful.** No data would be lost by dropping the old tables
*today*.

> **But note what that does and does not buy you.** It is only true as of this moment. **The app
> writes new sales to the old tables** — I created one through the UI an hour ago during the #9
> verification, and it landed in `BeverageSale`, not in `Sale`. Every sale the owner records
> between now and the switch-over widens the gap again. **The copy being complete is a snapshot,
> not a standing guarantee**, and it will need re-checking immediately before B whenever B
> eventually runs.

---

## Step 3 — The literal generated SQL

Generated with `prisma migrate diff` against the **live database**, using a throwaway copy of the
schema in a temp directory (since removing four models also requires removing their back-relations
on `Customer` and `Product`). **The real `prisma/schema.prisma` was never edited for this**, and
the temp copy has been deleted.

```sql
-- DropForeignKey
ALTER TABLE "BakerySale" DROP CONSTRAINT "BakerySale_customerId_fkey";

-- DropForeignKey
ALTER TABLE "BakerySaleItem" DROP CONSTRAINT "BakerySaleItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "BakerySaleItem" DROP CONSTRAINT "BakerySaleItem_saleId_fkey";

-- DropForeignKey
ALTER TABLE "BeverageSale" DROP CONSTRAINT "BeverageSale_customerId_fkey";

-- DropForeignKey
ALTER TABLE "BeverageSaleItem" DROP CONSTRAINT "BeverageSaleItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "BeverageSaleItem" DROP CONSTRAINT "BeverageSaleItem_saleId_fkey";

-- DropTable
DROP TABLE "BakerySale";

-- DropTable
DROP TABLE "BakerySaleItem";

-- DropTable
DROP TABLE "BeverageSale";

-- DropTable
DROP TABLE "BeverageSaleItem";
```

**Assessed against your criteria — the SQL itself is clean:**

| Criterion | Result |
|---|---|
| Drops only the four old tables | ✓ `BakerySale`, `BakerySaleItem`, `BeverageSale`, `BeverageSaleItem` and nothing else |
| Cascade onto the unified model | **None.** No `CASCADE` keyword anywhere |
| Anything else touched | **No.** `Sale`, `SaleItem`, `Customer`, `Product`, `MilkSale`, `MilkDelivery`, `FarmerPurchase`, `Farmer`, `CustomerPayment`, `Settings`, `User`, `Category`, `SubCategory` are all absent |

**On the six `DropForeignKey` lines** — these are not collateral damage. Each constraint is *owned
by one of the four tables being dropped* and points outward at `Customer`, `Product`, or its own
parent sale. Postgres requires them dropped before the tables go. `Customer` and `Product`
themselves are untouched; they simply stop being referenced.

**So step 3 passes on its own terms. It is still not safe to run**, because the SQL being clean
says nothing about the 50 live call sites in step 1.

---

## What running B today would actually do

Not a theoretical concern — this is the concrete result:

| Screen / feature | After B |
|---|---|
| `/beverages`, `/bakery` — list, create, edit, delete | **broken** — `relation does not exist` |
| `/reports` — revenue, top products, CSV export | **broken**, and the raw-SQL ones only at runtime |
| Receipt printing | **broken** |
| `/customers` — balances, outstanding, ledger | **broken** |
| Catalog delete guard | **broken** |
| The one real bakery sale | survives — it is in `Sale` |
| `/sales` (the unified flow) | **does not exist to fall back to** |

The app would have no working sale path at all, because the replacement was never built.

---

## Recommendation

**Do not approve B.** The correct order is the one CLAUDE.md already records:

1. **CHECKLIST #4 — build the unified switch-over.** Unified API reusing `reconcileSaleLines` /
   discount / stock unchanged, the `/sales` form and edit UI, old routes redirecting, reports
   rewritten to `Σ netLineTotal` grouped by `SaleItem.moduleKey`, `lib/receipt.ts`,
   `lib/receivables.ts` (**CHECKLIST #6** — same work) and `lib/catalog-guards.ts` repointed.
2. **Browser-verify it** — create, edit, delete, report on and print a unified sale.
3. **Re-run step 2's reconciliation**, because new sales will have accumulated in the old tables in
   the meantime.
4. **Then B**, with this same SQL.

**Or decide to abandon the unification** and delete the dormant `Sale`/`SaleItem` tables instead —
also a legitimate answer, and cheaper. The app works today; the unified model buys mixed-category
bills and line-level module attribution. If you don't need those before handoff, abandoning is the
smaller risk. Either way it should be a decision, not a half-finished state carried into handoff,
which is what CHECKLIST #4 says.

---

## Housekeeping

- **Nothing was run.** No migration created, no schema file edited, no data touched.
- The temp schema used to generate the SQL has been deleted;
  `prisma/schema.prisma` shows only the `discountPercent` removal from item #9.
- **No `ZZ_TEST_` data was created for this** — everything here was read-only greps and `SELECT`s.
  The database is still 27 products / Saif / 1 bakery sale / 1 milk sale / 1 user, as left after
  the #9 cleanup.
- **Item #9 is still uncommitted**, awaiting your go from the previous step.

> ⚠️ **"5 real sales" again.** The brief's step 5 and closing line both reference 5 real sales.
> There are **2**: the bakery sale (Rs. 5,000) and the milk sale (Rs. 6,000), against the single
> customer Saif. `BeverageSale` is empty. Fourth session running for this figure. It matters most
> for CHECKLIST #2 (the data reset), where a delete set sized for 5 sales across 3 customers would
> be aimed at rows that don't exist — but it also mattered here: a reconciliation expecting 5 rows
> to have been copied would have looked alarmingly wrong when it is in fact correct.

---

## Awaiting

Steps 1–3 are above. **Step 1 fails, so I am not asking for a go — I'm recommending against one.**

If you disagree with the read, the fastest way to settle it is the grep in §1a: 44 live
`prisma.beverageSale` / `prisma.bakerySale` call sites, versus zero for `prisma.sale`.

Tell me which you'd like next: **build the #4 switch-over**, **abandon the unification and drop the
dormant tables instead**, or **commit item #9** which is still pending.
