# Migration D — widen `Product.stock` to `Decimal(10,2)`. **READY, NOT APPLIED.**

**Date:** 2026-08-12
**HEAD:** `6f18b52` · tree clean at start (0 tracked mods) · `migrate status` **8 applied, "up to date"**
**Database writes this turn:** **NONE.** Read-only queries only. No `migrate deploy/reset/dev`, no
`db push`, and **nothing was passed to `--shadow-database-url`**.

## 🔴 STOP — awaiting your explicit go before touching the live database

Everything is written and verified locally. **There is no rehearsal target** — see the bottom
section. Nothing will be applied until you say so.

---

## Step 1 — Analysis (read-only)

### The column, and the precedent

| Column | Type | Null | Default |
|---|---|---|---|
| **`Product.stock`** | **`integer`** (precision 32, scale 0) | NOT NULL | `100` |
| `Product.price` | **`numeric(10,2)`** | NOT NULL | — |

✅ `stock` is `integer` as expected, and **`price` in the same table is already `numeric(10,2)`** —
so this migration moves `stock` onto a shape the table already uses rather than introducing a new one.

### The widening is lossless

| Check | Result |
|---|---|
| Products | **27** |
| NULL stock | **0** |
| Non-whole values (`stock <> trunc(stock)`) | **0** |
| Values too large for `DECIMAL(10,2)` | **0** |
| min / max | **100 / 100** |
| Stock fingerprint | `23cc9f6e0d2128de22ba7487473ea525` |
| Product fingerprint | `95794a0bb44f1b15d541a60ef0bd5c51` |

✅ **Lossless.** Every row is exactly `100`; all 27 become `100.00`. Both fingerprints still match
the post-restore baselines, so the restored data is unchanged since verification.

### The 4 expected `tsc` errors — confirmed

Staged the schema change, regenerated the client, ran `tsc --noEmit` at 4096 heap. **Exactly 4, all
one root cause:**

```
app/api/bakery/sales/[id]/route.ts(166,11)     error TS2322
app/api/bakery/sales/route.ts(152,11)          error TS2322
app/api/beverages/sales/[id]/route.ts(176,11)  error TS2322
app/api/beverages/sales/route.ts(154,11)       error TS2322

  Type 'PrismaPromise<{ … price: Decimal; stock: Decimal; … }[]>'
    is not assignable to type 'Promise<SaleProduct[]>'
      Types of property 'stock' are incompatible.
        Type 'Decimal' is not assignable to type 'number'.
```

All four are the `loadSaleProducts({ findMany })` callback. They cluster there — and **only** there —
because `SaleProduct.stock` in `lib/sales.ts` is a **hand-written `number`**, not a Prisma-derived
type. That single hand-written line is the whole compile-time surface.

### The `failStockBlocked` / `serialize()` gap — confirmed, quoted

`lib/api.ts` **does not import `serialize`** (imports were `next/server` and `@/lib/auth` only). The
function shipped as:

```ts
export function failStockBlocked(
  error: string,
  shortBy: {
    productId: string;
    name: string;
    available: number;      // ← typed number, but nothing enforces it at runtime
    requested: number;
    shortfall: number;
  }[]
): NextResponse {
  return NextResponse.json({ data: null, error, shortBy }, { status: 409 });
  //                                          ^^^^^^^ raw, never serialized
}
```

And all four call sites hand it the shortfalls untouched:

```ts
return failStockBlocked(stockBlockMessage(shortfalls), shortfalls);
```

`StockShortfall.available` is assigned straight from `product.stock` in `findStockShortfalls`
(`lib/sales.ts:662`). So post-widening, `available` would be a `Prisma.Decimal`, and
`JSON.stringify` emits a Decimal as a **string**. Verified by execution:

```
JSON.stringify({ available: new Prisma.Decimal("100.00") })  ->  {"available":"100"}
```

**Answer: yes, the gap is real.** `available` would have shipped as `"100"`.

**Why that would have been nasty rather than obvious:** the type says `number`, so nothing fails to
compile. `StockBlockAlert` feeds `available` into `InlineStockEditor`, whose commit guard is
`if (next === stock) return;` — a `number === string` comparison that is *always* false. The owner
hits a stock block mid-sale, types the same number back, and the editor treats it as a change. It
would only ever show up in a browser, in the exact moment the owner is trying to recover a blocked sale.

**One more blocker found, worth knowing but NOT fixed this turn** (out of scope — flagging only):
`lib/validations/sales.ts` types quantity as `.int()`, which rejects `12.5`. That must be relaxed
when milk lines actually arrive; it does not affect this migration.

---

## Step 2 — The migration and the code fix

### Migration SQL

**`prisma/migrations/20260812120000_widen_product_stock/migration.sql`**

```sql
-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "stock" SET DEFAULT 100,
ALTER COLUMN "stock" SET DATA TYPE DECIMAL(10,2);
```

Generated with **`prisma migrate diff --from-schema-datasource`** — read-only introspection, **no
shadow database**, per CLAUDE.md's DATABASE SAFETY section. Hand-checked: one statement, one column,
one table. No cascade, no index or constraint drop, no other object. The `SET DEFAULT 100` clause is
Prisma re-asserting the default in the new type — correct and harmless. The file carries a header
explaining the why, the losslessness evidence, and how it was generated.

### Code diff — 3 files, all in `lib/`. **The four route files are untouched.**

**1. `lib/sales.ts` — normalise at the one boundary**

```diff
-  /** Units on hand, for the stock check. See computeStockDeltas below. */
+  /**
+   * Units on hand, for the stock check. See computeStockDeltas below.
+   *
+   * A PLAIN NUMBER, deliberately, even though the column became
+   * `Decimal(10,2)` in Migration D — normalised at the `loadSaleProducts`
+   * boundary by {@link toSaleProduct}. Money stays `Decimal` because it is
+   * summed and multiplied and a rounding error is a wrong bill; stock is only
+   * ever COMPARED here, and the arithmetic that actually moves it happens in
+   * Postgres inside `applyStockDeltas`' conditional increment, at the column's
+   * own precision. So the number never accumulates.
+   *
+   * This is also the type CLAUDE.md's Gotcha 2 asks for: Decimals become
+   * numbers at the boundary, not three layers down.
+   */
   stock: number;
```

```diff
+export type SaleProductRow = Omit<SaleProduct, "stock"> & {
+  stock: Prisma.Decimal | number;
+};
+
+function toSaleProduct(row: SaleProductRow): SaleProduct {
+  return { ...row, stock: Number(row.stock) };
+}
```

```diff
-    findMany: (ids: string[]) => Promise<SaleProduct[]>;
+    findMany: (ids: string[]) => Promise<SaleProductRow[]>;
   }
 ): Promise<Map<string, SaleProduct> | SaleProblem> {
   const unique = Array.from(new Set(productIds));
-  const products = await options.findMany(unique);
+  // Normalise here, once, so every check below and every caller downstream sees
+  // a plain `number` stock. See toSaleProduct.
+  const products = (await options.findMany(unique)).map(toSaleProduct);
```

**2. `lib/api.ts` — serialize the 409 payload**

```diff
 import { auth } from "@/lib/auth";
+import { serialize, type DecimalLike } from "@/lib/serialize";
```

```diff
-    available: number;
-    requested: number;
-    shortfall: number;
+    available: DecimalLike;
+    requested: DecimalLike;
+    shortfall: DecimalLike;
   }[]
 ): NextResponse {
-  return NextResponse.json({ data: null, error, shortBy }, { status: 409 });
+  // SERIALIZE. `shortBy` carries stock figures, and since Migration D
+  // `Product.stock` is a Decimal — which JSON.stringify emits as the STRING
+  // "100", not the number 100. See Gotcha 2 in CLAUDE.md.
+  //
+  // `loadSaleProducts` already normalises stock to a number before any of these
+  // figures are computed, so today every value arriving here is a plain number
+  // and serialize() is a no-op on it. This is the backstop for the next caller:
+  // the unified /api/sales will build shortfalls from its own query, and a
+  // Decimal leaking into this payload would not fail to compile — it would ship
+  // `available: "100"` and break `InlineStockEditor`'s `next === stock` guard in
+  // the browser, silently, exactly where the owner is trying to restock mid-sale.
+  return NextResponse.json(
+    { data: null, error, shortBy: serialize(shortBy) },
+    { status: 409 }
+  );
 }
```

**3. `lib/serialize.ts` — one word**

```diff
-type DecimalLike = Prisma.Decimal | number | string;
+export type DecimalLike = Prisma.Decimal | number | string;
```

`DecimalLike` was declared but not exported; `failStockBlocked` needs it for its widened parameter.

**Worth being explicit about the division of labour**, since the two fixes overlap: **fix 1 is what
makes the app correct today** — it stops any Decimal reaching the shortfall figures at all. **Fix 2
is a structural backstop** and is currently a no-op on live values. I have said so in the code
comment rather than letting a future reader assume it is load-bearing today.

### Schema comments corrected

`prisma/schema.prisma:44` — *"Beverages + bakery only; milk has no products"* — replaced with the
Migration D rationale **plus** an explicit note that `SaleProduct.stock` stays a `number` on purpose,
so the next person does not "finish the job" by widening it through the app layer.

`prisma/schema.prisma:~151` — *"Milk is NOT here — it has no products, no stock"* — replaced with the
2026-08-12 decision that milk joins the unified `Sale`, while recording that `MilkSale` stays live
until the switch-over ships.

### Verification — all green **with the schema change staged and the client regenerated**

| Check | Before fix | After fix |
|---|---|---|
| `tsc --noEmit` (4096 heap) | **4 errors** | ✅ **0 errors** |
| `next lint` | — | ✅ **No ESLint warnings or errors** |
| `npm run build` | — | ✅ **green**, all routes compiled |
| Edge bundle guardrail (production artifact, 240 KB) | — | ✅ **0 hits** for `@prisma/client` / `PrismaClient` / `bcryptjs` / `.prisma` |

The code fix resolves all 4 errors and introduces none.

### 🟢 A useful finding: there is no deploy-ordering hazard

I probed the current mismatched state — regenerated client expecting `Decimal`, live column still
`integer` — with a read-only query:

```
READ OK with mismatched client:
  cmsjhlfi1000duve826ian5m4  stock=100  (js type: object, isDecimal: true)
  prod_big_apple             stock=100  (js type: object, isDecimal: true)
```

**Prisma silently coerces the `int4` column into a `Decimal`. No error.** And `toSaleProduct`'s
`Number(row.stock)` produces `100` either way.

So the code fix is **both forward- and backward-compatible**: it is correct against the integer
column *and* against the decimal one. Code and migration can go in either order without a broken
window, and the app is not in a broken state right now while we wait.

---

## Step 3 — 🔴 No rehearsal target. Waiting for your go.

**There is nowhere to dry-run this.** `list_branches` returns `[]`, and the project is on the
Supabase **free tier**, which has no database branching. Re-checked this turn, not assumed.

**What that means plainly:** the first and only place this migration will ever execute is your live
database. There is no rehearsal, and I will not create one implicitly.

**The safety position is genuinely good, though**, and I want to be accurate rather than alarmist:

- The statement is a **widening**, the least destructive kind of `ALTER` — no data is transformed,
  Postgres rewrites `100` as `100.00`.
- Losslessness was **verified against the actual rows**, not assumed.
- Your `backup2.sql` remains a valid restore point — no data has changed since Migration C, which
  the fingerprints above confirm independently.
- The restore procedure is now documented and has been executed successfully once.

**On your explicit go, Step 4 will be:**

1. `npx prisma migrate deploy` (never `reset`, never `db push`).
2. Reconcile all 27 products — values identical, `100` → `100.00`, type now `numeric(10,2)`;
   re-run both fingerprints (the stock one changes representation `100`→`100.00`, expected, exactly
   as Migration C's `quantity` did; the *values* must reconcile).
3. Confirm the 2 real sales (bakery 5,000 / milk 6,000), Saif, and **all farmer data** untouched.
4. `migrate status` → **8 → 9**, ending `20260812120000_widen_product_stock`.
5. RLS still enabled on all 18 tables.
6. A `ZZ_TEST_` beverage sale that decrements stock correctly, then cleaned up with stock restored.
7. Commit as `feat(db): Migration D — widen Product.stock to Decimal(10,2) for litres`.

---

## Constraint compliance

| Constraint | Status |
|---|---|
| Nothing passed to `--shadow-database-url` | ✅ SQL generated via read-only `--from-schema-datasource` |
| No `migrate reset` / `db push` | ✅ only `migrate status` + `migrate diff --from-schema-datasource` |
| **Nothing applied to live** | ✅ database is byte-identical to the start of this turn |
| No `P3006` encountered | ✅ none |
| Widening + the one scoped code fix only | ✅ 3 `lib/` files, 1 schema comment pass, 1 migration file |
| Four sale route files untouched | ✅ verified — diff touches `lib/` and `prisma/` only |
| Farmer code and data untouched | ✅ never read or written this turn |
| No reporting repoint / unified API / milk product / stock bridge | ✅ none |
| `.env` / credentials untouched | ✅ |

**Note on the brief:** `docs/prompt.txt` is truncated mid-sentence at line 57 (`"- Farmer code and
data untouched. 2 real"`). I proceeded on the constraints already established in previous turns —
the 2 real sales and Saif must not be modified — which is plainly where that line was heading. If
the cut-off text carried anything else, tell me before I apply.

---

## State

| | |
|---|---|
| `HEAD` | `6f18b52` — **nothing committed this turn** |
| Staged (uncommitted) | `lib/api.ts`, `lib/sales.ts`, `lib/serialize.ts`, `prisma/schema.prisma`, + new `prisma/migrations/20260812120000_widen_product_stock/` |
| Live database | **unchanged**, still 8 migrations, `Product.stock` still `integer` |
| Typecheck / lint / build | ✅ all green with the change staged |
| Waiting on | **your explicit approval to run `migrate deploy`** |
