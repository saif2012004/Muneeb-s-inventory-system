# S4 — RECON & DESIGN (read-only). STOPPED for review before any code.

**Date:** 2026-08-14 · **HEAD:** `9e8c61c` (on top of `cbcd2eb`) · **Branch:** `main`
**Stage:** S4 recon/design. **No code written. No migration. No database write of any kind.**
**Ground truth:** confirmed clean — full report in
`docs/responses/2026-08-13-s4-ground-truth-confirmed.md`, summarised in §1 below.

> **This document is for your review. Nothing in it has been implemented.** It ends with
> **7 decisions** I need from you (§7) before implementation starts, each with a recommendation.

---

## 1. Ground truth — ✅ confirmed, nothing off

| Check | Expected | Actual |
|---|---|---|
| HEAD / branch | at/after CLAUDE.md docs commit on `cbcd2eb` | `9e8c61c`, `main`, tree clean bar docs |
| Migrations | 9, up to date | 9 on disk = 9 in `_prisma_migrations`, no drift, none rolled back |
| Customer / Farmer **Saif** | both present | both present, 1 each |
| Real sales | bakery 5,000 · milk 6,000 · beverage 0 | exactly that |
| Farmer net owed | 5,000 | 30,000 − 25,000 = **5,000.00** |
| Products | 28 incl. `prod_milk` | 28; 27-product fingerprint **`b57a51bb…`** matches CLAUDE.md exactly |
| `prod_milk` | stock 0, unit litre, "Milk Shop" | all three |
| `grep -c "product\|stock" lib/milk.ts` | **0** | **0** |
| RLS / FORCE RLS | 18 of 18 / 0 | 18 of 18 / 0 |
| `ZZ_TEST_` leftovers | none | none |

**Your two answers, recorded:**

- **Q1 → one flat list, one total.** No per-category subtotals on the printed receipt.
- **Q3 → yes, exactly that.** Milk sits in the product list like any product; tap it, type litres
  (fractions fine), rate pre-fills from the catalog and is editable for that sale, milk stock goes
  down when it sells.

---

## 2. What exists today (verified by reading the code, not by trusting notes)

| Piece | Where | State |
|---|---|---|
| Unified create | `app/api/sales/route.ts` | ✅ live, POST only |
| Unified helpers | `lib/unified-sales.ts` | ✅ loader, module resolution, detail select |
| Money + stock | `lib/sales.ts` | ✅ `computeLineTotal`, `computeStockDeltas`, `applyStockDeltas`, `reconcileSaleLines` |
| Milk bridge | `lib/milk-stock.ts` | ✅ deliveries move milk stock by delta |
| **`GET /api/sales`** | — | ❌ **does not exist** |
| **`/api/sales/[id]`** | — | ❌ **does not exist** — no detail, **no DELETE** |
| **A unified screen** | — | ❌ **does not exist**; no `/sales` route |
| Per-module screens | `/beverages`, `/bakery`, `/milk/sales` | ✅ live, still the only way to sell |

So today `POST /api/sales` is reachable only by a hand-made HTTP call. **S4 is what turns it into
something the owner can use.**

---

## 3. Six findings that shape the design

These came out of the read-through and each one changes what S4 must contain. Three are traps that
would have shipped silently.

### 🔴 F1 — A unified sale is INVISIBLE to every screen that reads money

`POST /api/sales` writes `Sale`/`SaleItem`. **Nothing reads those tables.** Verified by grep — the
only match in the whole app is the route's own read-back (`app/api/sales/route.ts:199`).

| Read surface | Reads | A unified sale appears? |
|---|---|---|
| Customer outstanding / receivables | `BeverageSale` + `BakerySale` + `MilkSale` (`lib/receivables.ts:106-108,173-190,250-252`) | ❌ **no** |
| Customer ledger + profile | same, via `getCustomerActivity` (`:334-347`) | ❌ no |
| Reports revenue / counts | raw SQL over the old tables (`lib/reports.ts:384-400`) | ❌ no |
| Reports top products | `beverageSaleItem` / `bakerySaleItem` groupBy (`:217,224`) | ❌ no |
| Receipt | `BeverageSale` / `BakerySale` (`lib/receipt.ts:124-131`) | ❌ **no — cannot be printed** |
| CSV export | old tables (`app/api/reports/export/route.ts`) | ❌ no |

**Consequence, stated plainly: if the owner rings a bill on the new till today, the customer's
outstanding balance does not move, no receipt can be printed, and the sale is in no report.** A
screen shipped without a read side would be a screen that loses money on paper. **S4 must bring at
least receivables and the receipt across with it** — see the design in §5.

### 🔴 F2 — The migration-A `Sale` row shares its id with the real BakerySale row

Verified on the live database:

```
Sale.id = cmsjh3kly0002uve8ajkvs2ji, total 5000.00, 1 item, moduleKey "bakery"
                     ↑ the SAME id exists in BakerySale (1 match). BeverageSale: 0.
```

It is migration A's **copy** of the real bakery sale, not a second sale. So a naive read bridge that
sums `Sale` **on top of** the old tables **double-counts Saif's Rs. 5,000**:

| | Correct | Naive bridge |
|---|---|---|
| Saif outstanding | 5,000 + 6,000 = **11,000** | 5,000 + 6,000 + 5,000 = **16,000** ❌ |

Any bridge must exclude `Sale` rows whose id also exists in the old tables. That exclusion is
**self-healing**: it covers exactly 1 row today and 0 rows after S5 tidies the duplicate, so it does
not need remembering later. Design decision **D1**.

### 🔴 F3 — `SaleItem.quantity` is a `Decimal`, and the stock helpers take a `number`

`computeStockDeltas` accumulates with `(deltas.get(id) ?? 0) + amount`. Feed it a `Prisma.Decimal`
and JavaScript resolves `0 + Decimal` through `valueOf()`, which decimal.js returns as a **string** —
so `0 + Decimal(12.5)` is the string `"012.5"`, not the number `12.5`. It does not throw, it does not
fail to compile (`StockDeltas` is `Map<string, number>`, and a Decimal reaches it through an
`ExistingSaleLine` the caller builds by hand). **It silently corrupts the restock on delete.**

The per-module DELETE never hits this because `BeverageSaleItem.quantity` is an `Int`. The unified
one will, on its first line. **`Number(item.quantity)` at the boundary**, exactly as
`loadUnifiedSaleProducts` already does for stock (`lib/unified-sales.ts:128`). This gets its own test
with a fractional-litre line.

### 🟠 F4 — The shared sale form CANNOT be reused unchanged (two hard blockers)

| Blocker | Where | Effect on a unified screen |
|---|---|---|
| Quantity must be a **whole number** | `lib/validations/sale-form.ts:92-95` — `Number.isInteger` | "12.5" litres is rejected client-side. Milk cannot be sold. |
| The form **always sends `discountPercent`** | `components/sales/NewSaleForm.tsx:226` | The unified schema is `.strict()` with no discount → **every submit is a 400** |

Both are correct where they are and must stay for beverages/bakery. The unified screen needs its own
schema, and the shared components need two flags rather than a fork. Design decision **D3**.

### 🟢 F5 — Three things already work in our favour (no work needed)

- **`unit: "litre"` is not in `SELF_EVIDENT_UNITS`** (`lib/sale-catalog.ts:140`), so the existing
  helpers label a milk line **"Quantity (litres)"** and **"Price per litre"** with no milk-specific
  branching — precisely the Q3 interaction, for free.
- **The list plumbing is table-agnostic**: `SALE_LIST_SELECT`, `SALE_LIST_ORDER`,
  `buildSaleDateWindow`, `toSaleListRow` and `saleListQuerySchema` all fit `Sale` unchanged.
- **No migration is needed for any of S4.** `Sale`, `SaleItem`, `moduleKey`, decimal quantity and
  decimal stock are all already in place. **S4 does not go near the database schema** — which removes
  the single largest category of risk in this project from this stage entirely.

### 🟠 F6 — The milk cutover creates a reporting blind spot until S6

After the cutover, new milk sales land in `Sale` and `MilkSale` stops growing. Reports read
`MilkSale` for milk revenue and litres (`lib/reports.ts:398-400`), so **milk revenue on the
dashboard would freeze at the one historical sale** until the S6 repoint. Receivables I am proposing
to fix inside S4 (F1); reports are S6 by plan. Design decision **D5** covers how to handle the gap.

---

## 4. Recommended shape: S4 in three gated sub-stages

One gated stage at a time, as the project requires. Each ends with a STOP for your review. If you
prefer one big S4, say so — but the split means the risky parts arrive separately from the safe ones.

| | Sub-stage | Contains | Risk |
|---|---|---|---|
| **S4.1** | **API only** | `GET /api/sales`, `GET/DELETE /api/sales/[id]`, hooks | Low — additive, nothing existing changes |
| **S4.2** | **Screen + receipt + receivables** | `/sales`, `/sales/new`, unified receipt, receivables bridge | Medium — touches `lib/receivables.ts` (money) |
| **S4.3** | **Milk cutover** | `/milk/sales` → read-only history, warnings removed | Medium — changes the owner's daily path |

**Why this order:** S4.1 is fully testable over HTTP with no UI, so the DELETE-restores-stock
behaviour (F3) is proven *before* a screen depends on it. S4.2 makes it usable. S4.3 is last, so the
reporting blind spot (F6) exists for the shortest possible time and only after everything else is
proven.

---

## 5. The design, in detail

### S4.1 — the API half

**`GET /api/sales`** (add to the existing `app/api/sales/route.ts`)

- Reuses `saleListQuerySchema`, `buildSaleDateWindow`, `SALE_LIST_SELECT`, `SALE_LIST_ORDER`,
  `toSaleListRow` **verbatim** — no new filter or pagination logic.
- One addition: `items: { select: { moduleKey: true } }` in the select, deduped in JS into
  `modules: ["beverages","milk"]` per row, so a list row can show what is on the bill. **It is a
  JOIN, not a query** — zero extra round trips, which matters at ~1.1s each.
- Same `$transaction([findMany, count])` pairing the per-module list uses, so page and total agree.
- **Budget: 2 statements**, identical to `/api/beverages/sales`.

**`GET /api/sales/[id]`** — `UNIFIED_SALE_DETAIL_SELECT`, serialize, 404 sentence when missing.
**1 query.**

**`DELETE /api/sales/[id]`** — mirrors `app/api/beverages/sales/[id]/route.ts:267-317` structurally:

1. Read the sale's `{ id, productId, quantity }` lines.
2. Build restore deltas via `computeStockDeltas(..., { removedIds: allLineIds })` — **every delta
   positive, so a delete can never be blocked and needs no shortfall check.**
3. **`Number(line.quantity)` at that boundary — F3.** Non-negotiable, and tested with a 12.5 L line.
4. One transaction: delete items → delete sale → `applyStockDeltas`.
5. Response `{ deleted: "hard", id, itemCount }`, matching the existing contract.

**Hooks** — `lib/hooks/use-unified-sales.ts`, keys scoped `["unified-sales", …]` (the module-scoping
lesson from Phase 4). `onSuccess` invalidates unified sales **+ reports + customers**, the same trio
`invalidateAfterSale` uses, so the dashboard cannot show a stale total.

**Deliberately NOT in S4.1: `PATCH`.** See decision **D4**.

### S4.2 — the screen, the receipt, and the money it must show

**Routes:** `/sales` (list) and `/sales/new` (the till). **Accent: zinc/neutral** — the Design System
forbids mixing module accents on one screen, and a cross-module bill has no single module. Blue,
amber and emerald stay with their own modules; a per-line module chip can carry the colour if you
want the visual cue.

**The form.** Per the CLAUDE.md rule ("if you find yourself forking one of these components,
parameterise instead"), I propose **two flags on `SaleModule`** rather than a second form:

```
quantityMode : "integer" | "decimal"      // decimal → milk's 12.5 L validates
discounts    : true | false               // false → no discount fields rendered AND none sent
```

…with the form schema built by a small factory from those flags. One form, one price-preview
implementation, and the beverages/bakery behaviour is byte-identical because their flags reproduce
today's values. **The alternative — a separate `UnifiedSaleForm` — is decision D3.**

Everything else is reused untouched: `ProductPicker`, `CustomerCombobox`, `SaleDatePicker`,
`StockBlockAlert`, `AnimatedMoney`, `lib/motion.ts` springs.

**The picker across three categories.** `groupSaleProducts` groups by brand only, so "Milk" would sit
among Pepsi and Russ with no indication of category. Proposal: a `groupUnifiedSaleProducts` wrapper
that headings as **`Beverages · Pepsi`**, **`Bakery · Russ`**, **`Milk Shop · Milk`**. `ProductPicker`
itself needs **no change** — it renders `group.brand` as the heading string.

**The milk line, end to end (your Q3 answer):**

```
Tap  Milk Shop · Milk
     Quantity (litres)  [ 12.5 ]     <- label comes free from unit:"litre" (F5)
     Price per litre    [ 120  ]     <- pre-filled from catalog, editable
     Line total              Rs. 1,500.00
Save → Sale + SaleItem(moduleKey "milk") ; prod_milk.stock 40.0 → 27.5
```

⚠️ **One catch worth raising now: `prod_milk.price` is 0**, so "the rate fills from the catalog" fills
in **0** until a milk price is set. The catalog's inline price editor already does this in one tap —
it is your number to set, not mine to invent. Decision **D6**.

**The receipt — flat list, one total (your Q1 answer).**
New `/receipt/sale/[id]` + a `loadUnifiedReceipt` beside `loadReceipt`. **`ReceiptDocument` needs no
change**: `ReceiptData` is already shaped like a unified sale (the existing docblock says so at
`lib/receipt.ts:33-37`), lines print in entry order, and with no discounts on this endpoint
subtotal = total, so the discount rows simply do not render. Milk prints as **`12.5 litres × 120.00`**
through the existing `formatQuantity`. Paise on the receipt, whole rupees on screen — unchanged.
(`RECEIPT_LINE_CHARS` stays 32 until you confirm the 80mm printer; that remains a one-line change.)

**The receivables bridge (F1 + F2).** `lib/receivables.ts` gains `Sale` in all four paths
(`getCustomerBalance`, `getCustomerBalances`, `getTotalOutstanding`, `getCustomerActivity` →
`buildLedger`), **excluding `Sale` rows whose id exists in `BakerySale`/`BeverageSale`** so the
migration-A copy is not counted twice. Ledger rows label as "Sale · Beverages, Milk" from the
snapshotted `moduleKey`s. Cost: **+1 query per path** (4 → 5, about +1.1s on the customer profile) —
acceptable and well inside the ~12-query ceiling.

**Acceptance number for the whole of S4.2: Saif's outstanding must still read exactly Rs. 11,000**
before any test sale is created, and must return to Rs. 11,000 after every `ZZ_TEST_` sale is deleted.

### S4.3 — the milk cutover

- `/milk/sales` becomes a **read-only history list**: the "New milk sale" button and `MilkSaleDialog`
  come off, replaced by a link to the new till. The real Rs. 6,000 sale stays visible and untouched.
- `POST /api/milk/sales` is **left in place, just unreachable from the UI** — removing routes is S9's
  job, and deleting code mid-stream is how a rollback stops being possible.
- **`lib/milk.ts` is not touched.** The `grep -c "product\|stock"` → 0 invariant is re-checked before
  the commit, as it is for every stage.
- Milk stock becomes **authoritative**, so the provisional warnings come out — in the same commit,
  per the process rule: `CLAUDE.md` ("🥛 Milk stock" section + the Development Phases note),
  `lib/milk-stock.ts:33-40`, and `REMAINING-WORK.md` §2.

---

## 6. Test plan (all `ZZ_TEST_`-scoped, real data never touched)

| # | Test | Passes when |
|---|---|---|
| 1 | Mixed bill: Pepsi ×3 + Buns ×100 + Milk ×12.5 L | one `Sale`, 3 `SaleItem`s, `moduleKey` beverages/bakery/milk |
| 2 | Money to the paise | `totalAmount` = Σ `lineTotal` = Σ `netLineTotal`, exact |
| 3 | Stock decrements | all three products down by exactly their quantity; **milk by 12.5, not 12 or 13** |
| 4 | **DELETE restores stock (F3)** | every product back to its pre-sale value **to 2dp**, milk included |
| 5 | Stock block | a line exceeding stock → 409 `shortBy`, **no `Sale` row created, no stock moved** |
| 6 | Never negative | milk stock cannot be driven below 0 by a sale |
| 7 | GET list + detail | the sale appears with the right module chips, filters and pagination behave |
| 8 | **Receivables (F1/F2)** | Saif = **11,000** before; test sale adds exactly its own total; delete returns it to **11,000** |
| 9 | Receipt | prints flat, one total, milk as `12.5 litres × …`, no line exceeds the roll width |
| 10 | Farmer money untouched | net owed still **5,000**; delivery 250 L / 30,000; purchase 25,000 |
| 11 | Product fingerprint | 27-product `b57a51bb…` unchanged after cleanup (excluding `prod_milk`, whose stock is meant to move) |
| 12 | `grep -c "product\|stock" lib/milk.ts` | **0** |

Cleanup deletes only `ZZ_TEST_`-prefixed rows, verified by re-running 8, 10 and 11.

---

## 7. DECISIONS I NEED FROM YOU (recommendation first in each)

**D1 — The double-count guard (F2).** ✅ *Recommend:* exclude `Sale` rows whose id exists in the old
sale tables. Self-healing (1 row today, 0 after S5), no data change, no migration. *Alternative:*
delete the duplicate `Sale` row first — but that is a gated real-data write for no gain, since S5
revisits it anyway.

**D2 — Does S4 include the receivables bridge, or does the unified screen ship blind?**
✅ *Recommend: include it.* A till whose sales do not reach the customer's balance is a till that
loses money on paper. *Alternative:* screen first, receivables in S6 — faster to ship, but then every
unified sale is invisible until then and I would not want you ringing a real bill on it.

**D3 — One parameterised sale form, or a separate unified form?** ✅ *Recommend: parameterise* (two
flags on `SaleModule`), which is what CLAUDE.md's shared-components rule asks for and keeps one money
preview. *Alternative:* a separate `UnifiedSaleForm` — less risk to the two working screens, at the
cost of a second copy of the same logic that will drift.

**D4 — Edit: now or next?** ✅ *Recommend: DELETE in S4, edit deferred.* The unified PATCH would reuse
`reconcileSaleLines` (already written, already stock-aware), but the edit **screen** is real work and
a wrong bill can be deleted and re-rung in seconds. *Alternative:* fold edit into S4 — bigger stage,
later finish. (Note: this is CHECKLIST #8, which has always been planned to land with the unified
screen. Deferring it inside S4 keeps that promise without inflating one stage.)

**D5 — The reporting blind spot after the milk cutover (F6).** ✅ *Recommend: accept it, briefly, and
do S6 next.* The app is not yet in daily use, receivables (the figure that matters for real money)
will already be correct, and reports get repointed wholesale in S6 rather than patched twice.
*Alternative:* add a minimal unified-revenue bridge to reports inside S4.3 — safer if you intend to
start using the app before S6 lands. **Tell me if you plan to start entering real sales before S6.**

**D6 — `prod_milk` has no catalog price (price 0).** ✅ *Recommend: you set it in `/catalog`* (the real
sale was Rs. 120/L) so the rate pre-fills. It is your number and a one-tap edit. *Alternative:* I set
a placeholder as part of S4 — a gated one-row write I would rather you make yourself, in keeping with
stock and shop details being the owner's to enter.

**D7 — What happens to `/milk/sales` after the cutover?** ✅ *Recommend: keep it as read-only history*
with the new-sale button removed and a link to the till — the real Rs. 6,000 sale stays visible where
you expect it. *Alternatives:* redirect the whole page to `/sales` (history hidden until S6 reporting
shows it), or leave both live (two ways to sell milk, one of which silently does not move stock — I
would advise against).

---

## 8. Where the nav lands (minor, but it needs saying)

`PRIMARY_NAV` has four thumb tabs: Dashboard, Beverages, Bakery, Milk (`lib/nav.ts:74-76`). The new
till wants to be one tap away. Cleanest fit: **"New sale" becomes a primary tab and Bakery moves to
the "More" sheet** — but that reshuffles a nav you may be used to, so I have left it out of the
recommendations above and will do whatever you say. Default if you have no preference: add **Sales**
to the sidebar in the full list and put a prominent "New sale" button on the dashboard, changing no
existing tab.

---

## 9. Guardrails held throughout this stage

- **No migration.** S4 touches no schema — verified against `prisma/schema.prisma` (F5).
- **`lib/milk.ts` untouched**; the `grep → 0` invariant re-checked before every commit.
- **Farmer money untouched** — no farmer table, balance or ledger is read or written by any of this.
- **Money helpers reused verbatim** from `lib/sales.ts`; no arithmetic is reimplemented anywhere.
- **`ZZ_TEST_` on every test row**, cleaned up and verified by re-checking the real-data fingerprints.
- **Gated:** implementation starts only after you answer §7, and each sub-stage stops for review.

---

**Status: recon and design complete, nothing implemented. Waiting on the 7 decisions in §7 —
D1, D2, D3 and D5 are the ones that change the shape of the work; D4, D6 and D7 are smaller.**
