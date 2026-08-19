# S3 — unified `POST /api/sales` implemented ✅

**Date:** 2026-08-13
**Commit:** **`90e8609`** — `feat(api): unified POST /api/sales across beverages + bakery (milk dormant)`
**Result:** **21/21 tests pass**, including all three regression-catchers. Fingerprints match baseline,
all `ZZ_TEST_` data removed, real records untouched.

**Pre-flight:** HEAD `8847fff`, 0 tracked mods, 9 migrations / "up to date". ✅

---

## Files

| File | Change |
|---|---|
| `app/api/sales/route.ts` | **new** — 213 lines, POST only |
| `lib/unified-sales.ts` | **new** — 182 lines: loader, module resolution, both selects |
| `lib/validations/unified-sales.ts` | **new** — 106 lines: `unifiedSaleCreateSchema` |
| `lib/modules.ts` | +18 — the `milk` entry |
| `lib/sales.ts` | +48/−17 — the two-check extract |

`567 insertions, 17 deletions.` **No schema change, no migration.** The four per-module route files
are untouched.

---

## The `lib/sales.ts` extract

Two checks lifted out verbatim, so the owner-facing sentences exist once:

```diff
-  const missing = unique.filter((id) => !byId.has(id));
-  if (missing.length > 0) {
-    return { message: missing.length === 1 ? "One of the products…" : `${missing.length} of the products…`, status: 404 };
-  }
+  const unresolved = checkAllProductsResolved(unique, byId);
+  if (unresolved) return unresolved;

   const foreign = products.filter((p) => p.subCategory.categoryId !== options.categoryId);
   …unchanged…

-  const inactive = products.filter((product) => !product.isActive);
-  if (inactive.length > 0) {
-    return { message: `"${inactive[0].name}" is deactivated…`, status: 400 };
-  }
+  const inactive = checkNoInactiveProducts(products);
+  if (inactive) return inactive;
```

**Check ORDER is preserved exactly** — missing (404) → foreign category (400) → inactive (400) — so a
request failing two ways still gets the same message it did before. Message strings are byte-identical.

The single-category rule stayed put, and is now documented as the function's whole point:

> ⚠️ **THE SINGLE-CATEGORY RULE IS THIS FUNCTION'S POINT.** A mixed bill is REJECTED here on purpose…
> The unified endpoint deliberately does NOT reuse this. Do not "generalise" this one to serve both.

**Test #17 is the condition this extract rode on — it passed.**

---

## The milk entry, and the `tsc`-green proof

```diff
 export const MODULE_CATEGORIES = {
   beverages: { seedId: "cat_beverages", name: "Beverages" },
   bakery:    { seedId: "cat_bakery",    name: "Bakery" },
+  milk:      { seedId: "cat_milk",      name: "Milk Shop" },
 } as const;
```

**Confirmed green immediately after adding it, before anything else was built:**

```
=== tsc after ModuleKey widening (proof the grep was right) ===
  [errors: 0]
```

The design predicted this from a grep showing no `Record<ModuleKey, …>`; a green `tsc` is the proof.
The comment in the file explains why an unused-looking entry must not be deleted, and why there is
deliberately no `MILK_MODULE` in `lib/sale-modules.ts` (that file configures per-module sale *forms*,
which milk does not have).

---

## The endpoint

**Money — helpers reused verbatim, nothing reimplemented:**

```ts
const unitPrice = snapshotUnitPrice(product, item.unitPrice);   // create-only override
const lineTotal = computeLineTotal(unitPrice, item.quantity);   // discount arg omitted -> 0
…
netLineTotal: lineTotal,                                        // no discount => equal by definition
const { total: totalAmount } = computeSaleTotal(lines, new Prisma.Decimal(0));
const tooLarge = checkTotalFits(totalAmount);
```

**Transaction — both required changes:**

```ts
const created = await prisma.$transaction(async (tx) => {
    await applyStockDeltas(tx, stockDeltas);        // stock FIRST
    return tx.sale.create({ data: {…}, select: { id: true } });   // MINIMAL select
  }, { timeout: 15_000, maxWait: 5_000 });

const sale = await prisma.sale.findUniqueOrThrow({   // read-back OUTSIDE
  where: { id: created.id }, select: UNIFIED_SALE_DETAIL_SELECT,
});
return ok(serialize(sale), 201);
```

`StockConflictError` → 409; everything else → `serverError("sales.POST", error)`.

### One thing the design did not anticipate

`computeStockDeltas` consumes `SaleLine`, whose contract is **`quantity: number`** — it does plain
arithmetic on it (`prior.quantity - line.quantity`) — and `discountPercent` is **required** on that
type. But the brief requires `discountPercent` to be *omitted* from the write so the DB default
supplies the zero. So the maths shape and the write shape genuinely differ.

Resolved by building the write payload explicitly rather than spreading the line objects:

```ts
const itemWrites = lines.map((line) => ({
  productId: line.productId, moduleKey: line.moduleKey, quantity: line.quantity,
  unitPrice: line.unitPrice, lineTotal: line.lineTotal, netLineTotal: line.netLineTotal,
}));
```

`quantity` therefore stays a **number** through both paths — Prisma accepts a number for the Decimal
column, and a validated 2dp value is exact. Test #5 proves the round trip (`12.5` → stored `12.50`).

---

## Test results — 21/21

```
PASS  # 1  Mixed beverage+bakery bill reconciles to the paise   total=1067 (826.50 + 240.50)
PASS  # 2  Sigma netLineTotal == totalAmount (SQL)              SUM=1067.00 total=1067
PASS  # 3  moduleKey per line (read from DB)                    beverage=beverages bakery=bakery
PASS  # 4  Stock decremented across BOTH categories             bev 100->97, bak 100->98
PASS  # 5  Decimal quantity stored 12.50 and priced exactly     qty=12.5 lineTotal=125 (12.5 x 10)
PASS  # 6  Price override honoured on create                    unitPrice=275.5
PASS  # 7  Omitted unitPrice snapshots catalog price            unitPrice=0 catalog=0
PASS  # 8  ALL-OR-NOTHING shortfall                             see below
PASS  # 9  Discount rejected with 400 (bill AND line)           bill=400 line=400
PASS  #10  Unknown field rejected (.strict)                     status=400
PASS  #11  Non-2dp quantity rejected                            1.005 -> 400
PASS  #12  Quantity 0 and -1 rejected                           0->400 -1->400
PASS  #13  Product in an unmapped category -> 409               status=409
PASS  #14  Missing product 404, deactivated product 400         missing=404 inactive=400
PASS  #15  Missing customer -> 404                              status=404
PASS  #16  Transaction well under 15s                           8653ms end-to-end
PASS  #17  OLD per-module routes behaviour-neutral              see below
PASS  #18  Shared .int() validator STILL rejects 2.5            bev=400 bak=400
PASS  #19  Signed out -> 401 JSON envelope                      status=401 ct=application/json
PASS  #20  Cleanup: Sale back to 1 migration-A row              Sale=1 SaleItem=1 stock restored
PASS  #21  shortBy.available is a NUMBER, not "100"             typeof=number value=84.5
```

### 🔴 The three regression-catchers

**#8 — all-or-nothing shortfall.** A two-line bill where the bakery line is satisfiable and the
beverage line asks for 99,999:

```
status=409   sales 4->4   items 5->5   bev 84.5->84.5   bak 97->97
```

**No `Sale` row, no `SaleItem`, and stock unmoved on EVERY line — including the one that could have
been filled.** That is the property that matters: a partial commit here would silently consume stock
for a sale that was never recorded.

**#17 — the per-module routes after the extract.** Both created, decremented and restored on delete:

```
bev created=true 84.5->82.5 restored=true | bak created=true 97->95 restored=true
```

Exercised over real HTTP through the actual routes, not by calling the functions. **This is the
condition the extract was approved on.**

**#18 — the shared validator was not relaxed.** `2.5` still rejected on both old routes
(`bev=400 bak=400`), while the unified endpoint accepts `12.5`. Two schemas, disagreeing on purpose.

**#21 (added)** — asserts `shortBy.available` arrives as the **number** `84.5`, not the string
`"84.5"`. This is the first live exercise of Migration D's `failStockBlocked` + `serialize()` fix, so
it is worth having proven rather than assumed.

### ⚠️ One weak test, stated honestly

**#7 passed as `unitPrice=0 catalog=0`.** It confirms the snapshot path runs, but with a trivial
value — the seed ships every product at `price 0` and the owner has not set real prices yet. It does
**not** prove a non-zero catalog price is copied correctly. #6 covers the override with a real
`275.50`, so the more dangerous direction is genuinely tested; re-check #7 once real prices exist.

---

## Data integrity

| | Baseline | After all testing | |
|---|---|---|---|
| **Stock fingerprint** | `91c0ca3185c4daadd4a9c7be1bfa0e77` | **identical** | ✅ |
| **Product fingerprint** | `b57a51bb57be89cbc9db646d4a2a9972` | **identical** | ✅ |
| `Product` | 27 | 27 | ✅ |
| `Sale` / `SaleItem` | 1 / 1 | **1 / 1** (migration-A row only) | ✅ |
| `Category` / `SubCategory` | 2 / 11 | 2 / 11 | ✅ |
| `User` | 1 | 1 (temp user removed) | ✅ |
| `BakerySale` / `MilkSale` | 5,000 / 6,000 | **5000.00 / 6000.00** | ✅ |
| `BeverageSale` | 0 | 0 | ✅ |
| Customer / Farmer | Saif / Saif | Saif / Saif | ✅ |
| **Farmer net owed** | 5,000 | **5000.00** | ✅ |
| Stray `ZZ_TEST_` products / categories | — | **0 / 0** | ✅ |

**No farmer table was written to at any point.** The temporary `ZZ_TEST_` category, sub-category and
product created for test #13 were all removed, and stock consumed by the unified test sales was
restored explicitly (the unified endpoint has no DELETE route this stage).

## Build

| Check | Result |
|---|---|
| `tsc --noEmit` (4096 heap) | ✅ 0 errors |
| `next lint` | ✅ no warnings or errors |
| `npm run build` | ✅ Compiled successfully; `/api/sales` listed |
| Edge bundle guardrail (production artifact) | ✅ 0 hits |

---

## Constraint compliance

| Constraint | Status |
|---|---|
| Money helpers reused verbatim, no arithmetic reimplemented | ✅ |
| Shared `.int()` validator NOT relaxed | ✅ test #18 |
| Per-module paths not removed or rewired | ✅ test #17 |
| Milk `Product` NOT created, stock bridge NOT built | ✅ |
| Farmer code untouched | ✅ never opened |
| No schema change, no migration, no dependency installs | ✅ |
| Never `--shadow-database-url` | ✅ |
| `.env` not committed | ✅ staged set is the 5 files listed |

---

## State and what's next

| | |
|---|---|
| `HEAD` | **`90e8609`** (was `8847fff`) |
| Migrations | 9, unchanged |
| Both sale paths | live — per-module and unified |
| Working tree | clean apart from untracked `docs/responses/*.md` |

Not pushed; no instruction to.

**Milk was not tested and could not be** — no Milk Shop category and no milk Product exist, so
nothing resolves to `"milk"`. The design carries it structurally: the `cat_milk` entry, decimal
quantity (Migration C) and decimal stock (Migration D) are all in place, so the gated stage that
creates the milk product should need **no change to this endpoint**. What that stage must test: a
line resolving to `moduleKey "milk"`, a fractional-litre quantity end-to-end, milk stock
decrementing, and a genuine three-module bill.

**Next in sequence:** S4 (the unified screen) — which also needs `GET /api/sales`, deliberately left
out of this turn.
