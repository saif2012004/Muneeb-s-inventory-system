# Ground-truth audit — definitive Phase 8 state, and CLAUDE.md reconciled

**Date:** 2026-08-11
**Method:** code-read and live SQL only. No memory, no prior session reports taken on trust.
**Frontend pass:** not started, as instructed.
**Headline:** **CLAUDE.md was right all along.** The drift is entirely upstream — in the session
briefs. Six narrow figures in CLAUDE.md were stale and are now fixed; its central claims were all
correct.

---

## 1. UNIFIED SALE — dormant. The app runs entirely on the old tables.

**Does any live code read or write `Sale` / `SaleItem`?**

```bash
grep -rn "prisma\.sale\.|prisma\.saleItem\.|tx\.sale\.|tx\.saleItem\." app lib components scripts
```
```
(zero matches)
```

**Is there a `/sales` route?** No. Every page route in the app:

```
app/(dashboard)/page.tsx                     → /
app/(dashboard)/beverages/page.tsx           → /beverages
app/(dashboard)/beverages/new-sale/page.tsx  → /beverages/new-sale
app/(dashboard)/bakery/page.tsx              → /bakery
app/(dashboard)/bakery/new-sale/page.tsx     → /bakery/new-sale
app/(dashboard)/catalog/page.tsx             app/(dashboard)/customers/page.tsx
app/(dashboard)/customers/[id]/page.tsx      app/(dashboard)/milk/page.tsx
app/(dashboard)/milk/balances/page.tsx       app/(dashboard)/milk/farmers/[id]/page.tsx
app/(dashboard)/milk/quick-entry/page.tsx    app/(dashboard)/milk/sales/page.tsx
app/(dashboard)/reports/page.tsx             app/(dashboard)/settings/page.tsx
```

No `/sales`. The only `sales` directory is `milk/sales`, which is the milk module.

**Where a sale is actually created:**

```
app/api/bakery/sales/route.ts:205        return tx.bakerySale.create({
app/api/beverages/sales/route.ts:207     return tx.beverageSale.create({
app/api/milk/sales/route.ts:167          const sale = await prisma.milkSale.create({
```

Three separate module tables. The API tree is `app/api/{bakery,beverages,milk}/sales` — no unified
endpoint.

> **Confirmed as the whole truth: the unified-sale "rework" earlier sessions reported was NOT wired
> in.** Migration A ran — the tables exist and hold a copy — but no application code was ever
> switched over. `Sale`/`SaleItem` have never been written to by the app.

---

## 2. MIGRATION B — not run

**Models still in `schema.prisma`:**
```
91:model BeverageSale {      105:model BeverageSaleItem {
121:model BakerySale {       135:model BakerySaleItem {
```

**Tables still in the database** (`information_schema.tables`): `BakerySale` (7 cols),
`BakerySaleItem` (7), `BeverageSale` (7), `BeverageSaleItem` (7) — alongside `Sale` (7) and
`SaleItem` (9).

**54 live references:** 44 Prisma client calls + 4 generated types (`Prisma.BakerySaleWhereInput`
etc.) + 6 raw SQL strings.

### The 9 files

| # | File | What it does |
|---|---|---|
| 1 | `app/api/beverages/sales/route.ts` | list + **create** beverage sales |
| 2 | `app/api/beverages/sales/[id]/route.ts` | read / edit / delete |
| 3 | `app/api/bakery/sales/route.ts` | list + **create** bakery sales |
| 4 | `app/api/bakery/sales/[id]/route.ts` | read / edit / delete |
| 5 | `app/api/reports/export/route.ts` | CSV export |
| 6 | `lib/catalog-guards.ts` | the product/category delete guard |
| 7 | `lib/receipt.ts` | receipt data |
| 8 | `lib/receivables.ts` | customer balances |
| 9 | `lib/reports.ts` | revenue + top products — **6 of its refs are raw SQL** |

The `lib/reports.ts` raw SQL is the one that would not fail at compile time: a table-name map at
`:92–93` interpolated into a query, plus literal `FROM "BeverageSale"` at `:384–390`. Those go
green through `tsc` and break in the browser.

---

## 3. GUARDS — confirmed, both

### There is NO customer-delete guard

`DELETE /api/customers/[id]` reads `Customer`, sets `isActive = false`, returns. That's all:

```ts
const customer = await prisma.customer.findUnique({ where: { id: params.id }, … });
if (!customer) return fail("That customer no longer exists.", 404);
const deactivated = await prisma.customer.update({
  where: { id: customer.id }, data: { isActive: false }, select: CUSTOMER_SELECT,
});
return ok({ deleted: "soft" as const, … });
```

**Sale-table references in that entire file: 0.** History is protected structurally — the row is
never removed — so there is no lookup to get wrong. It is also **unreachable from the UI**:
`useDeactivateCustomer` exists in `lib/hooks/use-customers.ts:202` and no component imports it.

### The sale-reading guard is the PRODUCT / CATEGORY guard

`lib/catalog-guards.ts`, keyed entirely on `productId` — the word "customer" does not appear:

```
49:   by: ["productId"],                                    (beverageSaleItem.groupBy)
54:   by: ["productId"],                                    (bakerySaleItem.groupBy)
86:   prisma.beverageSaleItem.count({ where: { productId } })
87:   prisma.bakerySaleItem.count({  where: { productId } })
```

It is the single implementation behind category, sub-category and product DELETE. **Untouched** —
`git diff --stat lib/catalog-guards.ts` is empty.

---

## 4. RECEIVABLES — live in code, removed only from the UI

**Both halves are true, and the distinction matters.**

**Live:** `lib/receivables.ts` has **16 Prisma calls** (8 of them against `beverageSale`/
`bakerySale`, plus milk and `customerPayment`), and is imported by **8 route files**:

```
app/api/customers/route.ts                          getCustomerBalances
app/api/customers/[id]/route.ts                     getCustomerActivity
app/api/customers/[id]/balance/route.ts             getCustomerBalance     ← the route exists
app/api/customers/[id]/payments/route.ts            getCustomerBalance
app/api/customers/[id]/payments/[paymentId]/route.ts getCustomerBalance
app/api/milk/sales/route.ts                         getCustomerBalance
app/api/milk/sales/[id]/route.ts                    getCustomerBalance
app/api/reports/export/route.ts                     getCustomerBalances
```

It executes on every customer request and every milk-sale write.

**Removed:** only the presentation. `CustomerProfile.tsx:30` — *"This screen used to carry Total
billed / Total paid / Outstanding tiles… a sale is revenue, not a debt."* `PaymentDialog.tsx` is
defined and **never rendered** anywhere (`<PaymentDialog` matches nothing), same as
`useDeactivateCustomer`.

**So: balances are computed and returned on every request, and nothing displays them.** Migration B
would leave 8 live routes querying dropped tables.

---

## 5. DATA — 2 sales, 1 customer

| Table | Rows | |
|---|---|---|
| `BeverageSale` | **0** | empty, confirmed |
| `BakerySale` | **1** | Rs. 5,000 |
| `MilkSale` | **1** | Rs. 6,000 |
| `Sale` (unified) | 1 | migration A's copy of the bakery row — same id, **not** a second sale |
| `SaleItem` | 1 | |
| `Customer` | **1** | `Saif` |
| `CustomerPayment` | 0 | |
| `Product` | 27 | |
| `User` | 1 | the owner |

**Two real sales totalling Rs. 11,000, one customer.** Not 5 and 3.

---

## 6. UNCOMMITTED — confirmed, and there is a second one

`HEAD` is **`873054e`** — *"fix: login POST-only, no credentials in URL on no-JS fallback"*. The
`discountPercent` drop is applied to the database but not committed:

```
 M app/api/products/[id]/route.ts      M lib/hooks/use-catalog.ts
 M app/api/products/route.ts           M lib/hooks/use-sales.ts
 M components/catalog/CatalogManager.tsx  M lib/sale-catalog.ts
 M components/catalog/ProductDialog.tsx   M lib/sales.ts
 M components/catalog/ProductTable.tsx    M lib/validations/catalog.ts
 M lib/catalog-display.ts              M lib/validations/sales.ts
 M prisma/schema.prisma                M prisma/seed.ts
?? prisma/migrations/20260810180000_drop_product_discount_percent/
?? prisma/migrations/20260809180000_unify_sale_tables_part_a/     ← NEW FINDING
```

### 🔴 New finding: two applied migrations are untracked in git

`_prisma_migrations` shows all 7 applied and none rolled back:

```
20260802201127_init                      2026-08-02 20:11
20260803000000_enable_rls                2026-08-02 20:35
20260809000000_add_sale_discount_percent 2026-08-08 20:55
20260809120000_add_product_stock         2026-08-08 22:04
20260809180000_unify_sale_tables_part_a  2026-08-09 15:07   ← untracked in git
20260810120000_add_settings              2026-08-09 20:09
20260810180000_drop_product_discount_percent 2026-08-10 12:58 ← untracked in git
```

**A fresh clone would not contain either directory.** `migrate deploy` on a new environment would
produce a database with no unified `Sale` tables and still carrying `Product.discountPercent` —
silently divergent. Migration A has been untracked since 2026-08-09. Recorded as new CHECKLIST #16.

---

## 7. BUILD / TOOLING — your notes corrected

| Your note | Reality |
|---|---|
| "Context7 has failed ~10 sessions; node_modules is the accepted fallback" | **Context7 is UP.** Used successfully this session and on 2026-08-10; `/prisma/prisma` resolves with `__branch__6.19.x` selectable. It was down 3–9 Aug; it reconnected on the 10th, and CLAUDE.md already records that as closed. The `node_modules` fallback remains the *stronger* source for "what will actually run at the pinned version" — keep using it for that reason, not because Context7 is unavailable |
| "local prod builds OOM — build is verified via Vercel preview" | **`npm run build` completed green locally** on 2026-08-10, producing the full route table and a 234.6 KB middleware bundle. What OOM'd was **`tsc --noEmit`** at the default heap; it passes with `NODE_OPTIONS=--max-old-space-size=4096`. Local prod builds are available as a check |
| "snapshot integrity … reconcile by stable saleItemId" | Correct in substance. The field is `id` on the sale-item row, not `saleItemId` |
| "server re-snapshots price on edit" | **Partly false.** A client-supplied `unitPrice` still wins on PATCH (`lib/sales.ts:202` + the update branch at `:474`), and `NewSaleForm` always sends one. That is CHECKLIST #7, still open |
| "receipt prints paise while screen shows whole rupees" | Correct and verified — `{ precise: true }` in exactly one place, `ReceiptDocument.tsx:51` |

---

## Does CLAUDE.md reflect reality? **Mostly yes. Six figures fixed.**

**The reassuring part: CLAUDE.md's central claims were all correct.** Its
`🧭 WHICH SALE TABLES ARE LIVE` section already said *"The app runs on `BeverageSale` / `BakerySale`.
`Sale` / `SaleItem` exist but NOTHING reads or writes them"*, and the checklist already had
#4 `[~] NOT STARTED`, #5 `[ ]`, #6 `[ ]`. **The drift was upstream, in the session briefs, not in
the file.**

### What I changed

| Section | Was | Now |
|---|---|---|
| `WHICH SALE TABLES ARE LIVE` header | "verified 2026-08-10" | **RE-VERIFIED 2026-08-11**, plus a note that seven consecutive briefs asserted the opposite and that **the grep wins** over any brief |
| Database security ×4 + Data API item | "all **15** tables" / "**15** ×" / "all **17** tables" | **18** — the true count in `public` (17 models + `_prisma_migrations`), matching yesterday's advisor output |
| CHECKLIST #2 data warning | "1 sale, 1 customer, Rs. 5,000" | Full table: **2 sales** (bakery 5,000 + milk 6,000), 1 customer, `BeverageSale` 0, plus "do not read 1 row in `Sale` as data loss" |
| CHECKLIST #6 receivables | "Dormant — removed from the UI" | **"Dormant understates it"** — 16 Prisma calls, the 8 importing routes listed by name, and the fact that only the *presentation* was removed |
| CHECKLIST #16 | — | **New:** the two untracked applied migrations |

### What I deliberately did not change

- **Line 1113, "Phase 1 delivered … Prisma 6 schema (15 tables)"** — a historical record of what
  Phase 1 shipped, accurate for that phase. Not drift.
- **Checklist #4/#5/#6/#7/#8 statuses** — already correct.
- Anything about the sale model, guards, or the snapshot rules — already correct.

---

## Definitive Phase 8 status

| Item | Status |
|---|---|
| **#1 Login POST-only fix** | ✅ **Done and committed** (`873054e`), verified with JS disabled |
| **#9 `discountPercent` drop** | ✅ Migration applied + browser-verified — ⚠️ **UNCOMMITTED** |
| **#4 Unified `Sale` build** | ⬜ **Not started.** Zero code touches the unified tables |
| **#5 Migration B** | ⬜ **Not run.** Blocked on #4 — 54 live references |
| **#6 `lib/receivables.ts`** | ⬜ Open, and larger than recorded — 8 live routes |
| **#7 client `unitPrice` on PATCH** | ⬜ Open — snapshot integrity hole |
| **#8 Sale edit UI** | ⬜ Open, lands with #4 |
| **#16 Untracked migrations** | 🔴 **New** — commit both |
| **#2 / #2b Data reset + shop details** | 🔴 **BLOCKS GO-LIVE.** `Settings.configuredAt` still `NULL`, placeholders intact |
| **#3 Vercel Pro + Supabase backups** | 🔴 **BLOCKS GO-LIVE** |
| **#10–13 Touch targets, PWA, date locale, on-device** | ⬜ Open |
| **#14 Region co-location** | ⬜ Open |
| **#15 Data API surface** | ⬜ Owner decision |
| **Frontend elevation** | ⬜ Not started — prompt drafted in `2026-08-11-frontend-elevation-prompt.md` |

**Three go-live blockers, not two:** the data reset (#2), real shop details (#2b), and the
Pro/backups upgrade (#3). The login fix is closed.

---

## Housekeeping

- **Frontend pass not started**, as instructed.
- **No code, schema, migration or data changed.** The only writes this session were to `CLAUDE.md`
  (the six reconciliations above) and this report.
- **No `ZZ_TEST_` data created** — greps and read-only `SELECT`s. Database untouched: 27 products,
  Saif, 1 bakery sale, 1 milk sale, 1 owner account.
- CLAUDE.md's edits are **uncommitted**, alongside item #9's.

**Suggested next move:** commit item #9 together with the CLAUDE.md reconciliation and the two
untracked migration directories (#16). That clears the tree, fixes the fresh-clone hazard, and lets
the frontend elevation land on a clean baseline.
