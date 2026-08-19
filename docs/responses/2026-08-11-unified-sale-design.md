# Unified spot-payment checkout — RECON + DESIGN DOCUMENT

**Date:** 2026-08-11
**Code changes: ZERO.** No edits, installs, migrations, or data writes. Read-only greps, file reads
and `SELECT`s.
**Deliverable:** a design. Implementation is separately gated.

---

## STEP 0 — Ground truth

```
$ git log --oneline -1
95122e1 fix: speed up sheet open (500ms felt slow)

$ git status --porcelain
?? docs/responses/2026-08-11-chunk-1-motion-vocabulary.md
?? docs/responses/2026-08-11-chunk-2-implementation.md
?? docs/responses/2026-08-11-chunk-2-recon-and-plan.md
?? docs/responses/2026-08-11-statcard-reduced-motion-fix.md
```

**HEAD = `95122e1`** ✅ · tracked modifications **0** · deletions **0**.

### CLAUDE.md conflicts with the stated requirements — flagged, not reconciled

| # | CLAUDE.md says | The requirement says | Verdict |
|---|---|---|---|
| 1 | `SaleItem.moduleKey` is `"beverages" \| "bakery"` (schema doc comment) | Unified checkout spans **beverages, bakery AND milk shop** | **Real conflict.** The schema was designed for a two-module merge. Milk was explicitly excluded — see #2 |
| 2 | Migration A's header comment: *"Milk is NOT here — it has no products, no stock, and its own MilkSale table, and nothing in this merge touches it."* | Milk shop sales join the unified bill | **Direct contradiction.** The decided requirement supersedes it, and CLAUDE.md must be updated when this ships |
| 3 | Checklist #4 scope: *"unified API reusing `reconcileSaleLines` / discount / stock unchanged, `netLineTotal` apportioned pro-rata"* | Same, plus milk | Compatible, but the recorded scope understates the work |
| 4 | Checklist #6: repoint or delete `lib/receivables.ts` as part of #5 | *"Leave [credit] dormant. Do not remove it."* | **Conflict.** #6 says delete-or-repoint; the requirement says leave dormant. **Requirement wins** — but receivables reads `BeverageSale`/`BakerySale`, so dropping those tables later would break 8 live routes. See Risk R4 |

---

## STEP 1 — Recon

### 1.1 The `Sale` / `SaleItem` schema as it stands

```prisma
model Sale {
  id              String     @id @default(cuid())
  customerId      String                                   // REQUIRED
  customer        Customer   @relation(...)
  saleDate        DateTime   @default(now())
  discountPercent Decimal    @default(0) @db.Decimal(5, 2) // whole-bill
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
  sale            Sale    @relation(..., onDelete: Cascade)
  productId       String                                    // REQUIRED
  product         Product @relation(...)                    // REQUIRED FK
  moduleKey       String                                    // "beverages" | "bakery"
  quantity        Int                                       // INTEGER
  unitPrice       Decimal @db.Decimal(10, 2)
  discountPercent Decimal @default(0) @db.Decimal(5, 2)     // per-line
  lineTotal       Decimal @db.Decimal(10, 2)
  netLineTotal    Decimal @db.Decimal(10, 2)                // share after bill discount
  @@index([saleId]) @@index([productId]) @@index([moduleKey])
}
```

#### ❌ It is NOT adequate for a mixed bill that includes milk. Four specific gaps.

**Verified: milk has no products.** Only two categories exist —

| Category | Products |
|---|---|
| Bakery | 10 |
| Beverages | 17 |

`MilkSale` is `liters × ratePerLiter` with no product, no line items, no discount:

```prisma
model MilkSale {
  id  customerId  saleDate
  liters       Decimal @db.Decimal(8, 2)
  ratePerLiter Decimal @db.Decimal(8, 2)
  totalAmount  Decimal @db.Decimal(10, 2)   // liters * ratePerLiter
  notes  createdAt
}
```

| # | Gap | Why it blocks |
|---|---|---|
| **G1** | **`SaleItem.productId` is REQUIRED with an FK to `Product`** | A milk line has no product. **This alone makes a milk line impossible today.** Needs `productId String?` + a nullable relation |
| **G2** | **`quantity` is `Int`** | Milk sells in **litres** — `Decimal(8,2)`. 2.5 L cannot be represented. Needs a decimal quantity, or a separate `liters` column |
| **G3** | **No description/label for a productless line** | A milk line has nothing to render on screen or receipt — the product name is the label everywhere today. Needs a snapshotted `description` |
| **G4** | **`moduleKey` has no `"milk"` value**, and is a bare `String` with no constraint | Reports group by it. Adding `"milk"` is data-only, but every consumer's exhaustiveness must be revisited |

**Also worth noting (not blockers):** `Sale.customerId` is required — fine, since every sale today
picks a customer. And `Sale` has **no payment field**. For spot-payment-only that is correct: the
absence of a payment concept *is* the "paid in full" model. **Do not add one** — that would be
designing around credit, which is explicitly out.

### 1.2 The current per-module sale paths, end to end

| Layer | Beverages | Bakery | Milk shop |
|---|---|---|---|
| Entry screen | `/beverages/new-sale` → `NewSaleForm` | `/bakery/new-sale` → `NewSaleForm` | **`MilkSaleDialog` on `/milk/sales`** — a dialog, not a page |
| Create API | `app/api/beverages/sales/route.ts:207` `tx.beverageSale.create` | `app/api/bakery/sales/route.ts:205` `tx.bakerySale.create` | `app/api/milk/sales/route.ts:167` `prisma.milkSale.create` |
| Edit / delete | `.../sales/[id]/route.ts` (PATCH has no UI) | same | `app/api/milk/sales/[id]/route.ts` (**has** an edit dialog) |
| Money math | `lib/sales.ts` | `lib/sales.ts` | `lib/milk.ts:161` `computeMilkSaleTotal` |
| Stock | `computeStockDeltas` / `applyStockDeltas` | same | **none — milk has no stock** |
| Receipt | ✅ | ✅ | ❌ **cannot print** |

#### Money touch-points — name them, because they must not drift

All in `lib/sales.ts`, one implementation:

- `computeLineTotal(unitPrice, quantity, discountPercent)` — per-line, rounded 2dp
- `applySaleDiscount(subtotal, discountPercent)` — whole-bill, rounded 2dp again
- `sumLineTotals` → `computeSaleTotal` — the stacking order: **line discounts first, then bill**
- `roundMoney` (`MONEY_DP = 2`), `checkTotalFits` (`MAX_MONEY`)
- `snapshotUnitPrice` — **create-only**; update is server-authoritative (closed 2026-08-11, `62cf0d2`)
- `reconcileSaleLines` — matches by **stable line id**, never array index

Milk's money is elsewhere: `lib/milk.ts:161` `computeMilkSaleTotal(liters, rate)` — a bare
`Decimal.mul`, **no discount concept at all**.

#### The rounding asymmetry — the thing most at risk

- **Screen:** `formatPKR(v)` → whole rupees
- **Receipt:** `formatPKR(v, { precise: true })` → two decimals

`{ precise: true }` appears in **exactly one** runtime place — `components/receipt/ReceiptDocument.tsx:51`.
The unified receipt must keep it that way. Verified this session on a live sale:
screen `3 × Rs. 276 → Rs. 744 → Rs. 707`, receipt `3 × 275.50 → Rs. 743.85 → −Rs. 37.19 → Rs. 706.66`.

### 1.3 The milk boundary — mapped precisely

**This is the reassuring finding: milk-SHOP-SALE code and FARMER code barely touch.**

`lib/milk.ts` is one file holding both, but the split is total:

| Milk-SHOP-SALE exports | Farmer tables touched |
|---|---|
| `MILK_SALE_SELECT` (:80) | **none** |
| `computeMilkSaleTotal` (:161) | **none** |

| FARMER exports | Farmer tables touched |
|---|---|
| `DELIVERY_SELECT`, `PURCHASE_SELECT`, `computeDeliveryTotals`, `getFarmerBalance`, `getFarmerBalances`, `summariseFarmerBalances`, `getAllFarmerTotals`, `getFarmerActivity`, `summariseFarmerActivity`, `buildFarmerLedger`, `farmerBalanceTone` | `prisma.milkDelivery` (:213, :268, :373, :449), `prisma.farmerPurchase` (:218, :274, :377, :465) |

**`app/api/milk/sales/route.ts` references no farmer model at all.** Its imports are
`MILK_SALE_SELECT`, `computeMilkSaleTotal`, `getCustomerBalance`, plus generic sale helpers.
`MilkSalesList.tsx` mentions farmers only in a comment explaining the separation.

> **✅ SAFE TO ABSORB:** `MilkSale`, `MilkSaleDialog`, `MilkSalesList`, `app/api/milk/sales/**`,
> `MILK_SALE_SELECT`, `computeMilkSaleTotal`.
>
> **🚫 MUST NOT GO NEAR:** `Farmer`, `MilkDelivery`, `FarmerPurchase`; the other nine `lib/milk.ts`
> exports; `lib/milk-display.ts` (the sign-inversion rules); `QuickEntryGrid`, `DeliveryDialog`,
> `PurchaseDialog`, `FarmerProfile`, `FarmerBalanceSheet`, `FarmerDialog`;
> `app/api/milk/farmers/**`; `/milk/quick-entry`, `/milk/balances`, `/milk/farmers/[id]`.
>
> The **one** structural task is splitting `lib/milk.ts` so the two sale exports move out and the
> farmer file is left untouched. That is a file move, not a logic change, and it should be its own
> commit so a farmer-side regression would be impossible to blame on it.

### 1.4 Reporting — what must be repointed at cutover

| File | Reads today | Lines |
|---|---|---|
| `lib/reports.ts` | `prisma.beverageSaleItem.groupBy` / `bakerySaleItem.groupBy`; **raw SQL** table-name map + `FROM "BeverageSale"` / `"BakerySale"` / `"MilkSale"` | :92–94, :217, :224, :384–400 |
| `app/api/reports/export/route.ts` | `beverageSale`, `bakerySale`, `milkSale` `findMany` | :131, :156, :246 |
| `lib/receipt.ts` | `beverageSale` / `bakerySale` `findUnique` | :124, :128 |
| `lib/catalog-guards.ts` | `beverageSaleItem` / `bakerySaleItem` groupBy + count | :48, :53, :86, :87 |
| `lib/receivables.ts` | `beverageSale`, `bakerySale`, `milkSale`, `customerPayment` | :106–108, :173–185, :250–252, :334–336 |

**The raw SQL in `lib/reports.ts` is the dangerous one** — strings compile fine after a table drop
and fail at runtime. Any cutover verification must exercise `/reports` in a browser, not trust `tsc`.

**Revenue arithmetic changes shape:** today it is `SUM(totalAmount)` per table. After cutover it is
`Σ netLineTotal GROUP BY moduleKey` — which is *why* `netLineTotal` exists. Milk currently
contributes `SUM(MilkSale.totalAmount)` and `SUM(liters)`; litres have no home in `SaleItem` today
(gap G2).

---

## STEP 2 — The design

### 2.1 Schema changes required (Migration C — additive, before anything else)

```prisma
model SaleItem {
  productId    String?              // was required
  product      Product?  @relation(...)
  moduleKey    String               // now "beverages" | "bakery" | "milk"
  description  String               // NEW: snapshotted label, e.g. "Milk" or the product name
  quantity     Decimal @db.Decimal(10, 2)   // was Int — litres need decimals
  unitPrice    Decimal @db.Decimal(10, 2)   // = ratePerLiter for milk
  ...
}
```

**All additive or widening — no data loss, and it can ship long before cutover.**

- `productId` nullable: widening. Existing rows unaffected.
- `quantity` `Int` → `Decimal(10,2)`: widening. Postgres `ALTER TYPE integer → numeric` is
  lossless. **Every reader must be checked** — `Int` becomes `Decimal`, which is a Prisma type
  change and therefore a compile-time signal, not a silent one. Good.
- `description` needs a default or a backfill for the one existing `SaleItem` row.

**Deliberately NOT added:** any payment/paid/balance column. Spot payment means the absence of one.

### 2.2 The unified checkout screen

**Route:** `/sales/new` (and `/sales` for the list). `NewSaleForm` is already parameterised by a
`SaleModule` config and is 572 lines of working form — it is **adapted, not rewritten**.

Changes:

1. **Picker spans both catalogs.** Today `loadSaleProducts` *rejects* a cross-category line; that
   guard becomes "resolve the module from the product's category" instead. Group headers gain a
   category level so a mixed basket stays readable.
2. **A milk line is a special line type**, not a product. The picker offers "Milk" with litres +
   rate rather than a catalog product. It writes `productId: null`, `moduleKey: "milk"`,
   `description: "Milk"`, `quantity: <litres>`, `unitPrice: <ratePerLiter>`.
3. **Per-line discount and one bill discount** — unchanged stacking, unchanged helpers.
4. **Running total** via the existing `previewLineTotal` / `previewSaleTotal`.

### 2.3 Money logic — reuse, do not re-derive

`computeLineTotal`, `applySaleDiscount`, `computeSaleTotal`, `roundMoney`, `checkTotalFits`,
`reconcileSaleLines`, `snapshotUnitPrice` all apply **unchanged**. A milk line is just a line whose
unit price is a rate and whose quantity is litres.

**One genuinely new piece: `netLineTotal` apportionment.** Spread the bill discount pro-rata by
`lineTotal`, 2dp, **residue onto the largest line** so the parts sum to `totalAmount` exactly. It
belongs in `lib/sales.ts` beside the discount maths, and it needs its own tests — this is the one
place a rounding bug could make per-module revenue stop summing to the headline.

**`computeMilkSaleTotal` becomes redundant** — `computeLineTotal(rate, litres, 0)` is the same
arithmetic with discount support. Retire it *with* the milk sale route, not before.

**The rounding asymmetry is preserved by not touching it:** `{ precise: true }` stays in exactly one
place.

### 2.4 Atomic cross-category stock

`computeStockDeltas` / `applyStockDeltas` already run inside one transaction and are
module-agnostic — they key on `productId`. **Milk lines have `productId: null` and must be skipped**,
not treated as zero-stock. That is the one new branch, and it wants an explicit test: a mixed bill
must decrement the beverage and bakery products and leave milk alone, all in one transaction, with
the stock-shortfall `blockedBy` list still working.

> ⚠️ **Transaction budget.** Sale creation already runs ~6 queries in one interactive transaction
> against Prisma's **5s default**, and has failed on a slow day (documented). A mixed bill touching
> more products makes that worse. **Raise the transaction timeout or move the read-back outside the
> transaction as part of this work** — do not discover it in production.

### 2.5 One receipt for a mixed basket

`lib/receipt.ts` currently hard-codes `ReceiptModuleKey = "beverages" | "bakery"` and reads the two
old tables. It becomes one `prisma.sale.findUnique`. **Milk gains receipts for the first time** —
today `/milk/sales` has no print link at all.

Layout stays 32 chars (`RECEIPT_LINE_CHARS`, 58mm), paise preserved. Whether a mixed receipt shows
per-category subtotals is **an open question, not a decision** — see Q1.

### 2.6 Migration B — moving the 2 real sales

**Current live data, re-verified this turn:** `BakerySale` 1 row Rs. 5,000 · `MilkSale` 1 row
Rs. 6,000 · `BeverageSale` 0 · `Customer` 1 (`Saif`) · `Sale` 1 (Migration A's copy of the bakery
sale, same id, same `createdAt`).

Note the bakery sale is **already** in `Sale`/`SaleItem` from Migration A. So Migration B is
narrower than it sounds:

| Row | Action |
|---|---|
| Bakery Rs. 5,000 | **already migrated** — verify field-by-field, don't re-copy |
| Milk Rs. 6,000 | **new work** — becomes a `Sale` with one `SaleItem`: `productId: null`, `moduleKey: "milk"`, `description: "Milk"`, `quantity: 50`, `unitPrice: 120`, `lineTotal = netLineTotal = 6000.00`, `discountPercent 0` |

**Method — treat as irreversible in practice:**

1. Write it as SQL, generated via `migrate diff` where possible, hand-written where it is a data copy.
2. **Dry-run against a Supabase branch or a restored copy**, never first against live.
3. **Reconcile figure-by-figure before cutover:** row counts both directions, and
   `SUM(BeverageSale)+SUM(BakerySale)+SUM(MilkSale) == SUM(Sale.totalAmount)`, and
   `Σ netLineTotal == Σ totalAmount` per sale.
4. **Old rows are not deleted.** They stay as the reconciliation source until the drop gate.
5. Full stop-and-confirm before running live.

---

## 2.7 THE GATED CUTOVER SEQUENCE

**Invariant: at every stage the owner can record a sale. There is never a window where they cannot.**

| Stage | What ships | Gate to pass | Can record a sale? |
|---|---|---|---|
| **S1** | **Migration C** — additive schema (nullable `productId`, decimal `quantity`, `description`, milk `moduleKey`) | SQL reviewed; applied; nothing reads the new columns yet | ✅ old paths, untouched |
| **S2** | Split `lib/milk.ts` — move the 2 sale exports out, farmer file untouched | Farmer balances, ledger, quick entry, balance sheet all verified unchanged in a browser | ✅ unchanged |
| **S3** | Unified **API** (`/api/sales`) + `netLineTotal` apportionment + milk-line stock skip. **Nothing removed.** | Apportionment unit-tested; a `ZZ_TEST_` mixed bill via HTTP reconciles to the paise; stock correct across categories | ✅ old paths still live |
| **S4** | Unified **screen** at `/sales/new`, alongside the old ones | Mixed bill created in a browser on real numbers; totals match; receipt prints correct paise | ✅ **both** paths live |
| **S5** | **Migration B** — dry-run on a copy, reconcile, then live | Figure-by-figure reconciliation signed off. **Its own gate.** | ✅ both |
| **S6** | Repoint **reporting**: `lib/reports.ts` (incl. the raw SQL), CSV export, `lib/catalog-guards.ts`, `lib/receipt.ts` | `/reports` verified **in a browser** — the raw SQL will not fail at compile time. Revenue equals the pre-cutover figures | ✅ both |
| **S7** | **Remove** `/beverages/new-sale`, `/bakery/new-sale`, `MilkSaleDialog`; redirect old routes to `/sales/new` | A full sale recorded through the unified path only, end to end, including receipt | ✅ unified only |
| **S8** | **Soak.** Old tables kept as a live safety net. No code reads them except receivables. | **A proven interval of real use** — my suggestion: two weeks of the owner's actual sales, or a fixed number of real bills | ✅ unified |
| **S9** | **Drop old tables** (the old Migration B). Resolve `lib/receivables.ts` first — see R4 | Grep clean; reconciliation re-run immediately before; explicit go | ✅ unified |

**S7 is the earliest point anything is removed, and S9 the earliest anything is destroyed.**

### 2.8 Estimate

With credit out of scope. "Session" = one gated step of the size we have been working in.

| Stage | Sessions |
|---|---|
| S1 Migration C | 0.5 |
| S2 milk lib split | 0.5 |
| S3 unified API + apportionment + stock | **2–3** — the apportionment is the risk |
| S4 unified screen | **2** — cross-category picker + milk line type |
| S5 Migration B (dry-run, reconcile, live) | 1 |
| S6 reporting repoint | **1.5** — raw SQL, browser verification |
| S7 removal + redirects | 0.5 |
| S8 soak | 0 (elapsed time) |
| S9 drop | 0.5 |
| **Total** | **≈ 8.5–9.5 sessions**, plus the soak |

Honest caveat: S3 and S4 are where estimates slip. Everything money-carrying in this project has
needed a browser pass that found something.

---

## STEP 3 — Risks and open questions

### Questions needing YOUR or the OWNER's decision before building

| # | Question | Why it can't be assumed |
|---|---|---|
| **Q1** | **Does a mixed receipt need per-category subtotals?** Or one flat list of lines and one total? | Changes the receipt layout inside a 32-character line. The owner hands this to a customer |
| **Q2** | **Bill-level discount only, or keep per-line discounts too?** Both exist today | Per-line survives fine, but if the owner never uses it, dropping it simplifies the screen for someone working one-handed on a phone |
| **Q3** | **How does the owner enter a milk line?** A "Milk" entry in the product picker with litres + rate, or a separate "Add milk" button? | Affects the picker design. Milk is unlike every other line — it has no catalog entry and its rate changes |
| **Q4** | **Does the milk rate default to anything?** Today it is typed per sale | If there is a usual rate, it should prefill |
| **Q5** | **Should milk lines decrement anything?** Today milk has no stock | Confirming "no" fixes the design; if the owner wants milk stock, that is a separate feature |
| **Q6** | **How long is the S8 soak?** | It is the only thing standing between a bad cutover and unrecoverable data loss |

### Risks

| # | Risk | Mitigation |
|---|---|---|
| **R1** | **`netLineTotal` apportionment rounding** — parts not summing to `totalAmount` makes per-module revenue disagree with the headline | Residue-to-largest-line rule; unit tests; reconcile `Σ netLineTotal == totalAmount` per sale in S3's gate |
| **R2** | **Raw SQL in `lib/reports.ts` fails at runtime, not compile time** | S6 gate is a browser check, explicitly |
| **R3** | **Transaction timeout** — already marginal at ~6 queries vs Prisma's 5s default; a mixed bill is worse | Address in S3: raise the timeout or move the read-back out |
| **R4** | **`lib/receivables.ts` blocks S9.** It reads `BeverageSale`/`BakerySale` from **8 live routes**, and the requirement says leave credit dormant — so it cannot simply be deleted | Decide at S9: repoint it at `Sale` (keeping it dormant but valid), or make those routes stop calling it. **This is the one place "leave it dormant" and "drop the old tables" genuinely conflict** |
| **R5** | **`quantity` `Int` → `Decimal`** ripples through every consumer | It is a compile-time break, not a silent one — that is the good case. Budget a pass |
| **R6** | Milk sales currently have an **edit** dialog; beverages/bakery do not | The unified screen must decide whether editing exists at cutover, or milk loses a capability it has today |
| **R7** | Farmer side collateral damage | S2 isolates the split into its own commit with a farmer-side verification gate; the fence in §1.3 lists exactly what is off-limits |

---

## Summary

**The unified checkout is buildable and the existing money logic carries over almost entirely** —
`lib/sales.ts` is already module-agnostic, and the sale form is already parameterised.

**But the dormant `Sale`/`SaleItem` tables cannot hold a milk line as designed.** `productId` is a
required FK, `quantity` is an integer, and there is no label for a productless line. Migration A
built a *two-module* merge and its own comment says milk was excluded on purpose. Adding milk is an
additive schema change (S1), not a workaround.

**The milk/farmer boundary is clean** — the sale exports touch zero farmer tables, and the fence in
§1.3 is precise.

**Nothing was built, migrated or written.** The 2 real sales and Saif are untouched.

**Blocking on the six questions above**, particularly Q1 (receipt layout) and Q3 (how milk is
entered) — both change the screen and receipt design before a line of code is worth writing.
