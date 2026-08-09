# Session kickoff: CLAUDE.md read, points 1–7 confirmed — with two corrections

**Date:** 2026-08-10
**Status:** ⏸️ Nothing built, nothing migrated, nothing deleted. Confirmation only, as instructed.

CLAUDE.md read in full. Points **2, 3, 4, 5, 7 confirmed as stated**. Point **6 is half true** and
the half that isn't is load-bearing. Point **1 does not match the repository or the database**, and
I've verified that against both rather than asserting it.

Everything below was checked live this session — file reads, `git log`, and SQL against the
Supabase project — not carried over from the previous session's notes.

---

## 1. Where the build actually is — the unified Sale has NOT shipped

The brief says the merge "MOST RECENTLY" shipped, "with a sale-EDIT UI, and reports rewritten to
line-level Σ netLineTotal by moduleKey." **That code does not exist in this repository.** What
exists is **Migration A only** — the additive schema half.

| Claim in the brief | What the repo shows |
|---|---|
| One unified `Sale` holding mixed-category lines | ✅ **Tables exist** — `Sale` / `SaleItem` with `moduleKey` + `netLineTotal`, migration `20260809180000_unify_sale_tables_part_a`, applied 2026-08-09 15:07 |
| …and the app runs on it | ❌ **Nothing reads or writes them.** `grep` finds no `prisma.sale.` / `prisma.saleItem.` caller |
| Sale-EDIT UI | ❌ No `/sales` route. `app/(dashboard)/` = bakery, beverages, catalog, customers, milk, reports. No `useUpdateSale` hook |
| Unified API | ❌ `app/api/` still per-module: `beverages/sales`, `bakery/sales` |
| Reports rewritten to Σ `netLineTotal` by `moduleKey` | ❌ `lib/reports.ts:217,224` still `prisma.beverageSaleItem.groupBy` / `prisma.bakerySaleItem.groupBy` |
| Old two-table model gone | ❌ `BeverageSale`, `BeverageSaleItem`, `BakerySale`, `BakerySaleItem` all still in `schema.prisma` **and in the database** — deliberately, that's Migration B's job |

`git log`: last **code** commit is `d0ed825` (stock tracking). Everything after it is docs. The
working tree carries the modified `schema.prisma` + Migration A + response docs, uncommitted.

### The parts of point 1 that ARE confirmed

- **Batch 1 — dashboard/chart/caching:** shipped.
- **Batch 2 — receivables removed:** confirmed. `ReportsDashboard.tsx:240` states there is
  deliberately no outstanding-receivables tile; `CustomersHub.tsx` describes the debtor sort and
  headline in the past tense; `components/customers/PaymentDialog.tsx` is orphaned (zero
  references). Tables `CustomerPayment` etc. are intact and dormant — reversible, as described.
  ⚠️ One thing to know for the merge: `lib/receivables.ts` still sums **`BeverageSale` +
  `BakerySale`** + `MilkSale`. It's dormant so it's harmless today, but Migration B would leave it
  referencing dropped tables. It needs to be repointed at `Sale` or deleted as part of that work.
- **Batch 3 — discount as a sale-time %:** confirmed. `discountPercent Decimal(5,2)` on sale and
  line in all three families; stacking order and both rounding points live in `lib/sales.ts`; the
  27 surviving products carry no variants.
- **Stock:** confirmed. `Product.stock`, delta reconciliation in `computeStockDeltas`, conditional
  `updateMany … WHERE stock >= -delta` in `applyStockDeltas`, `StockConflictError` → 409.
- **Milk + farmers separate and untouched:** confirmed — `MilkSale`/`MilkDelivery`/`FarmerPurchase`
  are outside the merge entirely, and nothing in Migration A touches them.

### The 5-sales / 3-customers figure — the database says otherwise, again

Queried live, this session, via the Supabase MCP:

| | |
|---|---|
| `Sale` rows | **1** |
| `SaleItem` rows | **1** |
| `BakerySale` / `BeverageSale` | **1 / 0** |
| Customers in the whole database | **1 — "Saif"** |
| The one sale | `cmsjh3kly0002uve8ajkvs2ji` / Saif / 2026-08-07 / **Rs. 5,000.00**, Σ `netLineTotal` = 5,000.00 ✅ |
| Products / at stock 100 | 27 / (unchanged from the last cleanup) |
| Milk sales / deliveries | 1 / 1 |
| `CustomerPayment` | 0 |

There is **no "Muhammad Bilal"** row and no third customer. I've now been given this figure three
times and it has not matched once, so this session I checked something new instead of just
re-reporting the mismatch: **which database each side is pointing at.**

- `.env` `DATABASE_URL` → host `aws-1-ap-northeast-2.pooler.supabase.com`, project ref
  **`wcfdtxalwlztfsbepkrr`**
- Supabase MCP `get_project_url` → **`https://wcfdtxalwlztfsbepkrr.supabase.co`**

**Same project.** So the tool I'm querying with and the app on this machine are not the split. That
leaves only two candidates for where five sales could be visible: a **different Supabase project**
entirely (a second `.env`, or Vercel's project env vars pointing elsewhere), or a screen that isn't
this app. Both are cheap to settle — a screenshot of the list, or the URL in the address bar.

I'm not asking you to re-litigate it before I can work. **I'll take the instruction at face value
and never delete a sale in cleanup**, `ZZ_TEST_`-scope everything I create, and remove only that.
The figure only becomes blocking at **Migration B**, which drops the old tables: dropping them in
an environment whose contents I've never read would destroy the only copy available to reconcile
against. Until then it changes nothing about what I build.

---

## 2. Prisma v6 — confirmed and pinned

`@prisma/client ^6.19.3`. `schema.prisma` is v6-shaped exactly as the guardrail requires:
`provider = "prisma-client-js"` with **no** `output`, `url` + `directUrl`, no driver adapter, no
`prisma.config.ts`. I will not apply a v7 pattern from any doc.

---

## 3. Context7 — it's UP, and it can be pinned to 6.19.x

I tested it before writing this rather than assuming the 9-session outage:
`resolve-library-id("Prisma")` returned `/prisma/prisma` — **and it exposes a `__branch__6.19.x`
version alongside `6.19.2`**. That's better than the CLAUDE.md workaround: instead of reading v7
docs and mentally filtering, I can request the pinned branch directly. Worth folding into CLAUDE.md
next time it's edited.

**Source disclosure, this session:** everything above came from **the repository and the live
database** — file reads, `git log`, and SQL. No library docs were needed, so neither Context7 nor
`node_modules` was consulted for an API question. I'll name the source on every future lookup.

---

## 4. Database access — confirmed

All access is Prisma over the direct Postgres connection as the `postgres` role. `grep` for
`@supabase/supabase-js` across `app/`, `lib/`, `components/` returns **nothing** — the anon key is
not used anywhere. RLS verified live: **all 17 public tables have `relrowsecurity = true`, and
`relforcerowsecurity = false` on every one.** Migration A did the right thing — the new `Sale` and
`SaleItem` are both RLS-enabled, so the "new tables need `ENABLE ROW LEVEL SECURITY`" rule was
honoured. Zero policies, default deny, unchanged.

(The Supabase MCP I used for the counts above is read-only inspection, the sanctioned use — not an
application data path.)

---

## 5. Auth + Decimals — confirmed

`requireOwner()` in `lib/api.ts:83`; `auth()` from Auth.js v5. `grep` for `getServerSession`
returns only the two CLAUDE.md-style comments saying it doesn't exist in v5 — no call sites.
Signed-out `/api/` → `401 {data:null,error}` from the `authorized` callback, page requests → 307 to
`/login`. Money and litres are `Prisma.Decimal` end to end, serialized once at the route boundary
via `lib/serialize.ts`; all arithmetic is Decimal, server-side.

---

## 6. Snapshot integrity — ID matching ✅, "server never trusts client price" ❌

**Confirmed:** `reconcileSaleLines` matches by **stable line id**, not array index —
`currentById = new Map(existing.map(l => [l.id, l]))`, entry with `id` = that stored line, entry
without = new, absent = removed. It rejects a duplicate id (400) and an unknown id (409). I will
not simplify that to index matching. Also confirmed: `unitPrice` / `discountPercent` / `lineTotal`
are snapshotted onto the line, `moduleKey` and `netLineTotal` exist on `SaleItem` for the merge,
and a product swap re-snapshots the **price but deliberately not the discount**.

**Not confirmed — and I need a decision before I build:**

> *"the SERVER re-snapshots price from the DB on edits (never trusts client-supplied price)"*

That is **not what the code does**, and it isn't an oversight — it's documented behaviour in two
places:

- `lib/sales.ts` → `snapshotUnitPrice()`: *"An explicit `unitPrice` from the client always wins."*
- `lib/validations/sales.ts:95` → *"`unitPrice` is an OPTIONAL OVERRIDE."*
- CLAUDE.md, Price snapshot table: *"Explicit `unitPrice` sent for the line → that value wins over
  every row above."*

And the UI **always sends it** — `NewSaleForm.tsx:218`: *"unitPrice is ALWAYS sent: the owner may be
pricing a 0-priced product."* That's the original reason: the seed ships every product at price 0,
so the owner has to be able to bill a real price before walking the whole catalog.

The two rules genuinely conflict. Which one governs the unified build:

- **(A) Keep the override** (today's behaviour, CLAUDE.md as written) — the owner can price a
  0-priced product inline. Cost: a client can set any price on an edit.
- **(B) Harden as point 6 says** — server always reads price from the DB on **edit** (PATCH),
  override allowed only on **create**. Keeps the 0-price escape hatch where it's actually needed
  and closes it where history can be rewritten. **This is what I'd recommend**, and it's a small
  change: drop `line.unitPrice` from the update branch of `reconcileSaleLines` only.
- **(C) Remove the override entirely** — cleanest rule, but the owner can't sell a 0-priced product
  until the catalog is fully priced.

Tell me A, B or C and I'll implement it once, in `reconcileSaleLines`, and update CLAUDE.md's
snapshot table to match — right now the table and point 6 can't both be true.

---

## 7. Verification rule — confirmed

Real browser, real numbers. `tsc` is a type check, not a build; local prod builds OOM, so build
verification goes through a Vercel preview. Nothing gets called done on a green compile — the
mixed-category bill and the exact per-module split on a bill-discounted sale get checked on screen
with the numbers visible.

---

## What I need to start the build

Only **§6 (A/B/C)** is genuinely blocking, because it decides a line of the reconciler that the
whole unified API is built on top of.

**§1's sale count is not blocking** and I won't hold the build for it — but it *is* blocking for
Migration B, and I'd like a screenshot or a URL before we get there.

Given a `B` (or `A`/`C`), I'll run the build in one pass as previously specified: unified
`/api/sales` reusing `reconcileSaleLines` / discount / stock unchanged, `netLineTotal` apportioned
pro-rata with the residue on the largest line, the `/sales` form and edit UI in neutral-zinc with
per-line module dots, old routes redirecting, reports rewritten to line-level Σ `netLineTotal` by
`moduleKey`, then the full browser pass. Migration B only after you've seen all of it.
