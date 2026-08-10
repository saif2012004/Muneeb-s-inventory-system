# The unified-sale switch-over: the true, code-read state

**Date:** 2026-08-10
**Status:** ⏸️ Nothing changed. Receipt commit held. Dev server stopped.

The short version: **the app runs entirely on `BeverageSale` / `BakerySale`. Not one line of code
reads or writes `Sale` or `SaleItem`.** The rework is data-migrated and nothing else.

Every claim below is from reading the code in this working tree today, with the command that
produced it. Nothing is inferred from an earlier session's notes.

---

## 1. The decisive check

```
grep -rn "prisma\.sale\.|prisma\.saleItem\.|\.saleItem\b" app lib components
  --include=*.ts --include=*.tsx   [excluding beverageSaleItem/bakerySaleItem]
```

**Zero matches.** No route, no lib, no component queries the unified tables.

```
grep -rn "netLineTotal|moduleKey" app lib components
```

`netLineTotal`: **only in my new `lib/receipt.ts`, and only in a comment** explaining why it is
absent. `moduleKey`: a local variable name in the reports routes for a query-string parameter
(`const moduleKey = searchParams.get("module")`), plus my receipt code. **Neither is the `SaleItem`
column.**

The `Sale` and `SaleItem` tables exist in the database with `moduleKey` and `netLineTotal` columns,
carry one migrated row, and are **write-only dead weight** as far as the application is concerned.

---

## 2. Your four questions, answered

### Does the running app create/list/edit sales via `Sale` + `SaleItem`, or the old tables?

**The old tables. Every path.**

| Operation | Code | Model |
|---|---|---|
| Create | `app/api/bakery/sales/route.ts:205` | `tx.bakerySale.create({...})` |
| Create | `app/api/beverages/sales/route.ts:207` | `tx.beverageSale.create({...})` |
| List | `app/api/{bakery,beverages}/sales/route.ts` | `prisma.{bakery,beverage}Sale.findMany` / `.count` |
| Read one | `app/api/{bakery,beverages}/sales/[id]/route.ts` | `prisma.{bakery,beverage}Sale.findUnique` |
| Update (PATCH) | `app/api/{bakery,beverages}/sales/[id]/route.ts` | `prisma.{bakery,beverage}Sale.update` |

### Which sale-creation form is wired?

**The per-module `NewSaleForm`, twice — there is no unified form.**

- `app/(dashboard)/beverages/new-sale/page.tsx` → `<NewSaleForm module={BEVERAGES_MODULE} />`
- `app/(dashboard)/bakery/new-sale/page.tsx` → `<NewSaleForm module={BAKERY_MODULE} />`

`BEVERAGES_MODULE.apiBase` is `/api/beverages/sales`; `BAKERY_MODULE.apiBase` is
`/api/bakery/sales` (`lib/sale-modules.ts`). The form posts to whichever it is handed. **A sale
cannot contain both categories** — the API rejects a foreign-category product with
*"X is not a Bakery product, so it can't go on a bakery sale"* (`loadSaleProducts` in
`lib/sales.ts`).

### What do `/beverages`, `/bakery`, `/sales` actually hit?

| URL | Exists? | Renders | Hits |
|---|---|---|---|
| `/beverages` | ✅ | `<SalesList module={BEVERAGES_MODULE} />` | `/api/beverages/sales` → `BeverageSale` |
| `/bakery` | ✅ | `<SalesList module={BAKERY_MODULE} />` | `/api/bakery/sales` → `BakerySale` |
| **`/sales`** | ❌ | — | **The route does not exist.** |

Full list of pages under `(dashboard)`: bakery, bakery/new-sale, beverages, beverages/new-sale,
catalog, customers, customers/[id], milk, milk/balances, milk/farmers/[id], milk/quick-entry,
milk/sales, reports, settings, and the dashboard index. **No `sales` directory** — and none at
`app/sales` either.

### What do the reports query — old sale-level totals, or Σ `netLineTotal`?

**Sale-level totals on the old tables. There is no `netLineTotal` anywhere in reports.**

- **Summary** (`lib/reports.ts:384-400`), raw SQL:
  `(SELECT SUM("totalAmount") FROM "BeverageSale" …)`, `… FROM "BakerySale" …`,
  `… FROM "MilkSale" …`, `… FROM "MilkDelivery" …`, `… FROM "FarmerPurchase" …`
- **Trend** (`lib/reports.ts:154`): `Prisma.raw('"' + TREND_TABLE[module] + '"')`, where
  `TREND_TABLE = { beverages: "BeverageSale", bakery: "BakerySale", milk: "MilkSale" }` — one table
  per module, `SUM("totalAmount")` grouped by Karachi day.
- **Top products** (`lib/reports.ts:217, 224`): `prisma.beverageSaleItem.groupBy` /
  `prisma.bakerySaleItem.groupBy`, summing **`lineTotal`** — the per-module item tables.
- **CSV export** (`app/api/reports/export/route.ts`): `prisma.beverageSale.findMany`,
  `prisma.bakerySale.findMany`, `prisma.milkSale.findMany`.

So per-module revenue is still a **sale-level SUM**, which is exactly the thing the unification was
designed to replace — and it works today only because a sale cannot be mixed.

---

## 3. So: half shipped. Precisely which half

**Shipped (migration A):**
- `prisma/migrations/20260809180000_unify_sale_tables_part_a/` — applied 2026-08-09 15:07
- `Sale` + `SaleItem` tables exist, with `moduleKey`, `netLineTotal`, RLS enabled
- Saif's one bakery sale was copied across: `Sale` = 1 row, Rs. 5,000, `Σ netLineTotal` = 5,000.00 ✅

**Not shipped:**
- The unified API — no route touches the tables
- The `/sales` form — the route does not exist
- The edit UI — **`grep -rn "useUpdateSale"` returns nothing.** The `PATCH` endpoints are complete
  and server-verified but have no screen (the long-standing "not dead code" note in CLAUDE.md)
- Reports rewritten to line-level Σ `netLineTotal` — reports never changed
- Old routes redirecting — nothing redirects
- **Migration B — not written and not run.** `grep -rln "DROP TABLE" prisma/migrations/` returns
  nothing. Six migrations on disk, six in `_prisma_migrations`, none drops a table

**Corroborating evidence, independent of my greps:**

1. **Git history.** The last commit containing sale *code* is `d0ed825` "feat: stock tracking per
   product" (2026-08-09). Every commit after it is docs, settings or the receipt. There is no commit
   in `git log --all` that adds a unified sale API, form, or reports rewrite.
2. **The database agrees.** `BakerySale = 1` and `Sale = 1` are the *same* sale — the original and
   migration A's copy. If the app had switched over, new sales would be landing in `Sale` only.
3. **My own two responses on 2026-08-10** (`…-five-sales-correction-before-build.md`,
   `…-snapshot-asymmetry-verified-and-migration-b-refused.md`) both record that I stopped *before*
   this build and refused to run Migration B for exactly this reason.

**Why this matters beyond bookkeeping:** Migration B drops the four old tables. Running it against
today's code would delete the tables the entire application reads and writes — every sale screen and
every report would break immediately, and the only reconcilable copy of the data would be gone. The
two-part split was designed to prevent precisely that, and it is doing its job.

---

## 4. The receipt is unaffected by whichever way you decide

It is built against `BeverageSale` / `BakerySale` — what the app really uses — so it works today and
prints real sales. When the switch-over happens, **`loadReceipt()` in `lib/receipt.ts` is the only
thing that changes**: everything downstream consumes `ReceiptData`, which is already shaped like a
unified sale. Add `netLineTotal` to `ReceiptLine`, print it beside `lineTotal`, done. The layout,
the print CSS, the page and the button need no edit.

So the receipt does not need to wait on this decision — but it is your call whether to commit it now
or after the switch.

---

## 5. Done this turn

**Precision split recorded in CLAUDE.md**, as you asked — a new
`💰 THE RECEIPT PRINTS PAISE. THE SCREEN ROUNDS. DELIBERATE` block in the Design System, above the
Receipt printing section. It states the rule in both directions (do not round the receipt to match
the screen; do not add paise to the screen to match the receipt), carries the
`3 × 276 = 827` vs `3 × 275.50 = 826.50` demonstration, and records that it was found by printing a
real sale rather than by a build.

**Screen confirmed whole-rupee.** `grep -rn "precise: true"` across `app`, `lib`, `components`
returns **one** call site — `components/receipt/ReceiptDocument.tsx`. `SaleLineItems.tsx` (lines
111, 115, 130) and `SalesList.tsx` (409) all call plain `formatPKR`. Nothing on screen changed.

**Dev server stopped.** Ports 3000 and 3001 have zero listeners.

**Nothing committed.** Working tree:

```
?? app/receipt/            ?? lib/receipt.ts           M app/globals.css
?? components/receipt/     ?? lib/receipt-format.ts    M components/sales/SaleLineItems.tsx
                                                       M CLAUDE.md   (the precision note)
```

Plus the pre-existing untracked `prisma/migrations/20260809180000_unify_sale_tables_part_a/`.

---

## 6. The decision, framed

**Option A — commit the receipt now, finish the switch-over separately.** The receipt is correct
against what the app actually runs on, is browser-verified, and costs one file to re-point later.
Committing it stops it rotting in the working tree beside an unrelated migration folder. **This is
what I would do.**

**Option B — finish the switch-over first.** Larger: unified API reusing `reconcileSaleLines` /
discount / stock unchanged, `netLineTotal` apportioned pro-rata with the residue on the largest
line, the `/sales` form and edit UI, old routes redirecting, reports rewritten to Σ `netLineTotal`
by `moduleKey`, full browser verification, and only then Migration B. The receipt would be committed
after, already pointing at the new loader.

Either way, **Migration B stays unwritten until the switch-over is built and verified in a browser**
— dropping those tables is the one irreversible step here.

---

### Sources used

**This repository only** — `grep`, `find` and file reads over `app/`, `lib/`, `components/` and
`prisma/`, plus `git log` and the migration ledger. Live-database counts came from the Supabase MCP
(read-only inspection). No Context7 lookup: nothing here was a library-API question, it was a
question about what this codebase does.
