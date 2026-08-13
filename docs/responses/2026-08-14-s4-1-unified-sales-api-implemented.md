# S4.1 — unified sales API (list · detail · DELETE that restores stock)

**Date:** 2026-08-14 · **Result: 20/20 tests pass** over real authenticated HTTP.
**Real data untouched** — 27-product fingerprint identical, farmer net owed 5,000, both real sales
intact, `prod_milk` still 0. **No migration. No schema change.**

Design and the decisions this implements: `docs/responses/2026-08-14-s4-recon-and-design.md`.
Decisions taken (my recommendations, as instructed): **D1** id-exclusion guard, **D2** receivables
inside S4, **D3** parameterised form, **D4** delete now / edit next, **D5** reports stay S6,
**D6** `prod_milk` price left for the owner, **D7** `/milk/sales` becomes read-only history.
**D1–D3, D6, D7 belong to S4.2/S4.3 and are NOT in this commit.**

---

## 1. What shipped

| File | Change |
|---|---|
| `app/api/sales/route.ts` | **+ `GET`** — list, filtered, paginated |
| `app/api/sales/[id]/route.ts` | **new** — `GET` one, **`DELETE` that restores stock** |
| `lib/unified-sales.ts` | **+ `UNIFIED_SALE_LIST_SELECT`, `toUnifiedSaleListRow`** |
| `lib/hooks/use-unified-sales.ts` | **new** — TanStack bindings for all three |
| `CLAUDE.md` | updated in this commit, per the process rule (see §5) |

**Nothing existing changed behaviour.** `POST /api/sales`, the per-module routes and every screen are
untouched — test #18 exercises the three old list endpoints to prove it.

### `GET /api/sales`

Reuses the per-module list plumbing **wholesale** — `saleListQuerySchema`, `buildSaleDateWindow`,
`SALE_LIST_SELECT`, `SALE_LIST_ORDER`, `toSaleListRow`. Karachi-day filtering is therefore not a
second implementation that could drift from `/api/beverages/sales`; it is the same code (Gotcha 4).

The one addition is **`modules` per row** — which modules the bill touched — resolved from the joined
line `moduleKey`s. **That join costs no extra round trip**, which is the whole reason a list row can
carry it at ~1.1s per query. Budget: **2 statements**, identical to the per-module lists.

Order is fixed by `MODULE_CATEGORIES`, never by line order. Test #8 submits the lines
**milk → bakery → beverages** and asserts the row still reads `["beverages","bakery","milk"]`:
otherwise the same bill would label itself differently depending on which product the owner tapped
first, and a list that reshuffles its own labels reads as two different sales.

### `DELETE /api/sales/[id]` — and the trap it walks past

Structurally a mirror of `app/api/beverages/sales/[id]/route.ts`: read the lines, build **positive**
restore deltas through `computeStockDeltas`, then delete items → delete sale → `applyStockDeltas`,
all in one transaction. A restore can never be short of stock, so it needs no shortfall pre-check.

> 🔴 **`Number(line.quantity)` is load-bearing.** `SaleItem.quantity` is `Decimal(10,2)`
> (Migration C) while `StockDeltas` is `Map<string, number>` and `computeStockDeltas` accumulates
> with `(deltas.get(id) ?? 0) + amount`. Hand it a `Prisma.Decimal` and JS resolves the `+` through
> `valueOf()`, which decimal.js returns as a **string** — `0 + Decimal(12.5)` is `"012.5"`.
>
> **It does not throw and it does not fail to compile** (`ExistingSaleLine` is a hand-written type
> this route fills in itself). It would just silently restock the wrong amount. The per-module DELETE
> never meets this because `BeverageSaleItem.quantity` is an `Int`. **Test #14 is the proof**, using
> a 12.5-litre line specifically.

One deliberate difference from the per-module route: a `StockConflictError` is answered **409 with an
actionable sentence** rather than falling through to a 500. On a delete the only way the conditional
update matches zero rows is the product having been removed from the catalog entirely — nothing is
broken, so a 500 would be the wrong shape.

### Hooks

`lib/hooks/use-unified-sales.ts`, keyed `["unified-sales", …]` — a **separate namespace** from the
per-module `["sales", module.key, …]`, so a unified list and a module list can never serve each
other's rows from cache (the Phase 4 lesson).

One improvement over the per-module hooks: `invalidateAfterUnifiedSale` also invalidates **the
catalog**. Every line moves `Product.stock`, and the catalog is where the owner reads it — the
per-module hooks invalidate sales + reports + customers but leave a stale stock figure on screen.

---

## 2. Test results — 20/20

Run against a local dev server over real HTTP with a genuine session cookie (temporary `ZZ_TEST_`
owner, deleted afterwards). The milk line used a **`ZZ_TEST_` milk product under `cat_milk`**, never
`prod_milk`, so no real product's stock moved at any point.

```
PASS  #1  Signed out -> 401 JSON on GET and DELETE               get=401 delete=401
PASS  #2  GET list returns the migration-A row, serialized       total=1 amount=5000 modules=["bakery"]
PASS  #3  POST mixed 3-module bill reconciles to the paise       status=201 total=2566.5 (1500+240+826.50)
PASS  #4  GET detail: moduleKey + netLineTotal per line          modules=milk,bakery,beverages
PASS  #5  Decimal quantity survives the round trip as a NUMBER   typeof=number value=12.5
PASS  #6  Non-zero CATALOG price snapshotted                     bakery=120 (catalog) beverages=275.5 (override)
PASS  #7  Sigma netLineTotal == totalAmount (checked in SQL)     SUM=2566.50 total=2566.50
PASS  #8  List row: modules in fixed order, not line order       ["beverages","bakery","milk"]
PASS  #9  Stock decremented across all three, milk FRACTIONALLY  bev=997 bak=998 milk=987.5
PASS  #10 Filters: customer, Karachi day window, backwards 400   customer=1 backwards=400 future=0 today=1
PASS  #11 limit > 100 rejected with 400                          "Limit cannot exceed 100"
PASS  #12 Pagination: page 2 of 2 returns the older row          totalPages=2 rows=1
PASS  #13 Unknown id -> 404 sentence on GET and DELETE           get=404 delete=404
PASS  #14 DELETE restores stock EXACTLY, incl. 12.5 L            bev=999 bak=1000 milk=1000
PASS  #15 DELETE removes the sale AND its lines                  sale=0 items=0
PASS  #16 Second DELETE returns the last unit                    bev=1000
PASS  #17 saleDate stored as the Karachi calendar day            remaining row day=2026-08-08
PASS  #18 Per-module routes behaviour-neutral (still 200)        bev=200 bak=200 milk=200
PASS  #19 REAL DATA untouched                                    fp=identical prod_milk=0 Sale=1/1 netOwed=5000
PASS  #20 Cleanup: every ZZ_TEST_ row removed                    Sale=1 SaleItem=1 Product=28 Customer=1 User=1
```

**#14 in full**, since it is the one that matters: the mixed bill took 3 / 2 / 12.5 units, a second
bill held 1 more beverage, and after deleting the mixed bill the three products read
**999 / 1000 / 1000** — every unit back, the fractional litres to 2dp. Deleting the second bill
returned the last unit (#16).

**#6 strengthens S3's honestly-flagged weak test.** S3's snapshot test could only pass with
`unitPrice=0 catalog=0`, because every seeded product ships at 0. Here the bakery line **omitted**
`unitPrice` against a catalog price of **120** and stored exactly 120, while the beverage line's
**275.50 override** was honoured — so both directions are now genuinely proven.

### ⚠️ One weak test, stated honestly

**#17 is weak.** With every test sale deleted, only the migration-A row remained, so it asserts a
stored Karachi day exists rather than that a *new* sale bucketed correctly. The real evidence for
Karachi-day handling is **#10**: `dateFrom=dateTo=today` matched the sale created today and
`dateFrom=2099-01-01` matched nothing — and the window code is `buildSaleDateWindow`, shared verbatim
with the per-module routes that were verified in Phase 3.

---

## 3. Data integrity

| | Before | After |
|---|---|---|
| 27-product fingerprint (excl. `prod_milk`, excl. ZZ) | `b57a51bb…` | **identical** ✅ |
| `prod_milk.stock` | 0 | **0** ✅ |
| `Sale` / `SaleItem` | 1 / 1 | **1 / 1** ✅ |
| BakerySale / MilkSale | 5,000 / 6,000 | **5,000 / 6,000** ✅ |
| Delivery / purchase / **net owed** | 30,000 / 25,000 / **5,000** | **unchanged** ✅ |
| Customers / Farmers / Users / Products | 1 / 1 / 1 / 28 | **1 / 1 / 1 / 28** ✅ |
| `grep -c "product\|stock" lib/milk.ts` | 0 | **0** ✅ |

The temporary harness (`scripts/zz-test-s4.ts`) and the `ZZ_TEST_` owner account were deleted after
the run; the final cleanup assertion (#20) is what confirms it.

---

## 4. Build

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `next lint` | ✅ no warnings or errors |
| `npm run build` | ✅ compiled successfully |
| Edge-bundle guardrail | ✅ **0 hits** for `@prisma/client\|PrismaClient\|bcryptjs\|.prisma` |

The guardrail was run against a **production** `middleware.js` (234.6 KB, minified) with the dev
server stopped first — CLAUDE.md's documented false-positive trap avoided.

---

## 5. CLAUDE.md updated in this commit

Per the process rule, because this stage made four lines of it stale:

1. **Folder structure** — records `app/api/sales/[id]/route.ts` and the GET on `app/api/sales/`,
   including the `Number(quantity)` warning.
2. **"WHICH SALE TABLES ARE LIVE"** — the partial-switch-over note now says the unified API is live
   for read and delete too, **and states plainly that reports/receipt/receivables still read the old
   tables only**, so a unified sale does not yet reach a customer's balance or a receipt.
3. **CHECKLIST #4** — S4.1 marked shipped; the "unified path has no DELETE at all" line is closed;
   the remaining work is re-stated as S4.2 (screen + receipt + receivables) and S4.3 (milk cutover),
   with the unified **PATCH/edit** explicitly still open (CHECKLIST #8).
4. **Development Phases** — the S4 row split into S4.1 ✅ / S4.2 ⬜ / S4.3 ⬜.

---

## 6. What is deliberately NOT here

- **No PATCH / edit** (D4). The route would reuse `reconcileSaleLines`, which is already written and
  stock-aware, but the edit *screen* is real work and a wrong bill can be deleted and re-rung.
- **No receivables/receipt bridge yet** (D2) — that is S4.2, and until it lands **a unified sale is
  still invisible to the customer's outstanding balance and cannot be printed.** Written into
  CLAUDE.md rather than left to be discovered.
- **No milk cutover** (D7) — S4.3. `/milk/sales` still works exactly as before and milk stock still
  reads HIGH, as documented.
- **`prod_milk.price` left at 0** (D6). Your number to set; the till lets you type the rate anyway.

---

**Next: S4.2 — the unified screen `/sales` + `/sales/new`, the unified receipt (flat list, one
total, per your Q1), and the receivables bridge with the D1 id-exclusion guard. Stopping here for
your review first, as the gating requires.**
