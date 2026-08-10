# Migration B pre-flight, steps 1–3 — **step 1 still fails**

**Date:** 2026-08-11
**Ran:** nothing that changes anything. Read-only greps, `SELECT`s, and one `migrate diff` against
a throwaway schema copy (deleted afterwards; the real `schema.prisma` was never edited).
**Result:** step 2 **passes**, step 3 **passes**, **step 1 fails — unchanged at 54 live references.**

---

## First, a correction, because the rest depends on it

> The brief opens: *"Guard rewrite is right and verified both cases against the unified Sale while
> the old tables still exist — that's the dangerous silent-deletion path closed."*

**The guard was not rewritten.** I did not make that change, and my last report said so explicitly:
*"I have not made this change… it's your call, not mine to assume."* I offered it as option A and
asked. Nothing since then has modified any guard.

**Evidence, from the repo right now:**

```
$ git diff --stat lib/catalog-guards.ts
(no output — file untouched)

$ grep -n 'prisma\.\w*\.' lib/catalog-guards.ts
48:    prisma.beverageSaleItem.groupBy({      <- still the OLD tables
53:    prisma.bakerySaleItem.groupBy({
71:  const products = await prisma.product.findMany({
86:    prisma.beverageSaleItem.count({ where: { productId } }),
87:    prisma.bakerySaleItem.count({ where: { productId } }),
```

The complete list of modified files is item #9's fourteen and nothing else —
`lib/catalog-guards.ts` is not among them:

```
M app/api/products/[id]/route.ts      M lib/hooks/use-catalog.ts
M app/api/products/route.ts           M lib/hooks/use-sales.ts
M components/catalog/CatalogManager.tsx  M lib/sale-catalog.ts
M components/catalog/ProductDialog.tsx   M lib/sales.ts
M components/catalog/ProductTable.tsx    M lib/validations/catalog.ts
M lib/catalog-display.ts              M lib/validations/sales.ts
M prisma/schema.prisma                M prisma/seed.ts
```

And the two other things step 1 assumes were done are also not done — the old models are still
declared:

```
$ grep -n '^model \(BeverageSale\|BeverageSaleItem\|BakerySale\|BakerySaleItem\) ' prisma/schema.prisma
91:model BeverageSale {
105:model BeverageSaleItem {
121:model BakerySale {
135:model BakerySaleItem {
```

I'm flagging this plainly because **approving B on the belief that the guard is already safe would
be approving it on a false premise**, and B is the point of no return. Two further notes on that
paragraph, from the previous report: there is no *customer*-delete guard to rewrite (customer
deletion is an unconditional soft delete that queries no sale table and has no UI control), and
repointing the *product* guard at `SaleItem` today would **create** the silent-deletion path rather
than close it, because the app writes every sale to the old tables.

---

## Step 1 — Is the grep clean? **No. 54 live references, unchanged.**

```
client calls (prisma.* / tx.*) :  44      <- must be 0 to pass
generated types (Prisma.*Input):   4
raw SQL ("BeverageSale" etc.)  :   6
------------------------------------
TOTAL LIVE                     :  54
```

Identical to the count in yesterday's audit — nothing has been removed because the work that would
remove it (CHECKLIST #4, repointing 9 files onto `Sale`/`SaleItem`) has not been done.

The full file-by-file classification is in
`docs/responses/2026-08-11-migration-b-reference-audit.md`. The short version:

| | |
|---|---|
| 44 client calls | sale create/list/edit/delete, receivables, catalog guard, receipts, CSV export, top products |
| 4 generated types | `Prisma.BakerySaleWhereInput`, `…UpdateInput`, and the beverage equivalents |
| 6 raw SQL | `lib/reports.ts` — **these compile fine after the drop and fail at runtime** |

Also worth restating from that audit, since the brief mentions clearing it: **the seed does not
reference these tables at all.** `prisma/seed.ts` writes categories, sub-categories and products
only. It will survive B untouched — nothing to clear there.

**Step 1's gate is not met, so B does not run.**

---

## Step 2 — LAST-CHANCE reconciliation. **PASSES.** ✅

Run live, just now, while the old tables still exist. This is the part of the brief that is both
possible and genuinely worth doing today.

### Sale headers

| | |
|---|---|
| `BeverageSale` rows | **0** |
| `BakerySale` rows | **1** |
| **Old total** | **1** |
| `Sale` (unified) rows | **1** |
| Beverage sale ids **missing** from `Sale` | **0** ✅ |
| Bakery sale ids **missing** from `Sale` | **0** ✅ |
| `Sale` rows with **no** old-table origin | **0** ✅ |

### Sale lines

| | |
|---|---|
| `BeverageSaleItem` + `BakerySaleItem` | **1** |
| `SaleItem` (unified) | **1** |
| Beverage item ids **missing** from `SaleItem` | **0** ✅ |
| Bakery item ids **missing** from `SaleItem` | **0** ✅ |

**Every old row is accounted for in the unified tables, and there is nothing in the unified tables
that didn't come from an old row.** Migration A's copy is complete, in both directions, at header
and line level.

Field-level fidelity was verified in the 2026-08-10 pre-flight and still holds: same `id`,
`customerId`, `saleDate`, `discountPercent`, `totalAmount`, `notes`, `createdAt` on the header; same
`id`, `saleId`, `productId`, `quantity`, `unitPrice`, `discountPercent`, `lineTotal` on the line,
plus correctly derived `moduleKey='bakery'` and `netLineTotal=5000.00`.

> **Shelf life.** This is true as of now and stays true only while no new sale is recorded. The app
> writes to the old tables, so each new sale creates an old row with no unified counterpart. **Re-run
> this immediately before B whenever B eventually runs** — do not carry today's result forward.

---

## Step 3 — The literal generated SQL. **PASSES on its own terms.** ✅

Generated by `prisma migrate diff` **against the live database**, using a throwaway copy of the
schema in a temp directory (removing four models also requires removing their back-relations on
`Customer` and `Product`). **`prisma/schema.prisma` was never edited** — verified after: 17 models,
and the only diff is item #9's one-line `discountPercent` removal. The temp copy is deleted.

**742 bytes, verbatim:**

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

**Checked mechanically, not by eye:**

| Criterion | Result |
|---|---|
| `CASCADE` keywords in the file | **0** |
| Tables named that are **not** one of the four old ones | **none** — `Sale`, `SaleItem`, `Customer`, `Product`, `MilkSale`, `MilkDelivery`, `FarmerPurchase`, `Farmer`, `CustomerPayment`, `Settings`, `User`, `Category`, `SubCategory` all absent |
| `DROP TABLE` count | 4 — exactly the old sale + sale-item tables |

**On the six `DropForeignKey` lines:** each is a constraint *owned by one of the tables being
dropped*, pointing outward at `Customer`, `Product`, or its own parent sale. Postgres requires them
dropped first. `Customer` and `Product` are not altered — they simply stop being referenced.

So the SQL is exactly what you asked to confirm. **It is still not safe to run**, because a clean
statement says nothing about the 54 call sites in step 1.

---

## Steps 4–5, for when this is real

Both are ready to execute the moment step 1 can pass, and I've noted one thing about each:

- **Step 4** asks to re-test the customer-delete guard post-drop. As established, there is no
  customer-delete guard — customer deletion is an unconditional soft delete with no UI control. The
  guard that matters is the **product/category** guard in `lib/catalog-guards.ts`, and testing it
  post-drop is exactly right; it just needs to be described as what it is.
- **Step 5** asks to note in CLAUDE.md that the guard checks the unified `Sale` "so no one repoints
  it wrong later". Good instinct, and I want to write it — it should state what is actually true at
  the time, so it belongs in whichever commit genuinely repoints the guard.

---

## Housekeeping

- **Nothing run, nothing changed.** No migration created or applied, no schema edit, no code edit.
- **No `ZZ_TEST_` data created** — greps and read-only `SELECT`s only. Database unchanged:
  **27 products, Saif, 1 bakery sale (Rs. 5,000), 1 milk sale (Rs. 6,000), 1 owner account.**
- **Item #9 is still uncommitted** — the applied migration, 13 code files and the CLAUDE.md updates
  have been verified and waiting since 2026-08-10. That one only needs a "go".

> ⚠️ **"5 real sales" — seventh mention.** There are **2**, and `Sale` holds **1** row. Step 4 asks
> to verify "unified Sale intact with the 5 real sales"; that check would fail against a perfectly
> correct database. The reconciliation in step 2 above is the accurate picture: 1 old sale, 1
> unified sale, zero discrepancy.

---

## Awaiting

Steps 2 and 3 pass and are above in full. **Step 1 does not, and it is the gate**, so I'm not asking
for a go on B — and I'd ask you not to give one until the 54 references are repointed.

Four things you could tell me to do next, in rough order of how much they unblock:

- **A.** **Commit item #9** — verified, complete, waiting on nothing but your word.
- **B.** **Harden `lib/catalog-guards.ts` to check old *and* unified tables** — safe today, safe
  after B, no false "no history" in either direction. The only guard work that is correct to do
  before the switch-over.
- **C.** **Build CHECKLIST #4**, repointing all 9 files. This is what actually unblocks B.
- **D.** **Abandon the unification** — drop the dormant `Sale`/`SaleItem` instead. Closes the
  old/new ambiguity permanently, cheaply, and leaves the guard correct as it stands.
