# Unified sale — Migration A applied and verified

**Date:** 2026-08-09
**Migration:** `20260809180000_unify_sale_tables_part_a` — applied to the live database.
**Status:** ⏸️ **STOPPED AT STEP 2, as instructed.** Nothing built on it yet, nothing committed.

Migration B is **not** in `prisma/migrations/` and will not be until step 5.

---

## 1. One refinement I made before running it

The plan said "apply the schema", which as written meant replacing `BeverageSale`/`BakerySale`
with `Sale`/`SaleItem` in `schema.prisma`. Doing that literally would have left the working tree
**non-compiling** between this step and the build: the DB would still hold the old tables (A does
not drop them) while every route referencing `prisma.beverageSale` lost its model.

Since Migration A is additive, the old models can simply **stay** alongside the new ones until the
code moves over. So `schema.prisma` now declares all six models, `Customer` and `Product` carry
both sets of back-relations, and:

- `schema.prisma` and the database stay exactly in sync,
- the old code still compiles (`tsc --noEmit` clean after `prisma generate`),
- and the old models get removed in step 3, alongside the code that uses them.

I verified this changes nothing about the migration: diffing the live DB against the coexisting
schema produces **the same create-only DDL with zero `DROP` statements**. The schema diff is
**+63 lines, 0 deletions**.

---

## 2. The migration ran without aborting

That is itself the first result. Migration A carries four `RAISE EXCEPTION` guards — sale count,
item count, `moduleKey` validity, and the `SUM(netLineTotal) = totalAmount` reconciliation. Any
one of them rolls the whole transaction back. It committed, so all four held **as a precondition
of the data existing at all**, not as something checked afterwards.

---

## 3. Post-migration state

| Check | Result |
|---|---|
| `Sale` rows | **1** |
| `SaleItem` rows | **1** |
| Legacy rows still present (`BeverageSale`+`BakerySale`) | **1** — kept for the rollback window |
| Legacy items still present | **1** |
| Counts match legacy | **MATCH** |
| **Sales where `SUM(netLineTotal) <> totalAmount`** | **0** |
| Rows with an unknown `moduleKey` | **0** |
| Milk (sales / deliveries / purchases) | **1 / 1 / 1** — untouched |
| Products / at `stock = 100` | **27 / 27** — untouched |

### Saif's sale, migrated

| | Before (`BakerySale`) | After (`Sale`) |
|---|---|---|
| sale id | `cmsjh3kly0002uve8ajkvs2ji` | **identical** |
| total | 5000.00 | **5000.00** |
| line id | `cmsjh3kly0004uve8zootrgoy` | **identical** |
| quantity | 100 | 100 |
| lineTotal | 5000.00 | 5000.00 |
| **moduleKey** | — | **`bakery`** |
| **netLineTotal** | — | **5000.00** |

Ids preserved on both rows, so the sale keeps its identity and nothing referencing it can dangle.

### RLS

| Table | `rls_enabled` | `force_rls` |
|---|---|---|
| **`Sale`** | **true** | **false** |
| **`SaleItem`** | **true** | **false** |
| `BeverageSale` / `BakerySale` / `Product` | true | false |

And the Supabase security advisors, which CLAUDE.md requires re-running after any migration that
adds a table:

- **17 × `rls_enabled_no_policy` at INFO** — including `Sale` and `SaleItem`. That is the
  documented healthy steady state, not a regression.
- **0 × `rls_disabled_in_public` at ERROR** — the thing to actually watch for. The new tables did
  not slip through.

Worth noting for later: CLAUDE.md's "Database security" section says the advisors report **15**
tables. It is now **17**, and will change again when Migration B drops four. I'll update that
number as part of the same pass rather than leaving a stale count behind.

---

## 4. Where things stand

| | |
|---|---|
| Database | migrated; old and new tables coexist |
| `prisma/schema.prisma` | all six models, +63 / −0 |
| `prisma/migrations/` | Migration A present, **B absent** |
| Generated client | regenerated |
| `tsc --noEmit` | clean — existing code untouched and still compiling |
| Committed | **no** — per "don't commit until browser-verified" |
| App behaviour | **unchanged.** Nothing reads `Sale`/`SaleItem` yet; the app is still running entirely on the legacy tables. |

That last row is the important one: this migration is invisible to the running app. It has copied
data into a new shape that nothing consumes yet, which is exactly what makes stopping here safe.

---

## 5. Next, on your word

Step 3 onwards, as agreed:

1. **Unified API** — `reconcileSaleLines`, the discount maths and the stock reconciliation reused
   **unchanged**; they already work per line and do not care about modules. Adding the
   `netLineTotal` apportionment beside the discount maths in `lib/sales.ts`, one implementation.
2. **`/sales` form + edit UI** on the PATCH, neutral-zinc chrome with per-line module dots, old
   routes redirecting.
3. **Reports** rewritten to line-level `Σ netLineTotal` grouped by `moduleKey`.
4. **Browser verification** with numbers — the mixed bill, the exact module-split reconciliation on
   a bill-discounted sale, discount and stock across mixed lines, the edit UI, Saif's sale, milk.
5. **Migration B last**, shown to you before it runs.

---

### Source used

**Context7: attempted, still not connecting — 11th consecutive session.** Installed-source
fallback per the CLAUDE.md rule:

- Applied with `prisma migrate deploy` (never `migrate dev`, which can reset) from the installed
  Prisma 6 CLI.
- The coexisting schema was checked with `prisma validate`, and its equivalence to the reviewed
  migration confirmed by re-running `migrate diff` against the live datasource and getting
  create-only DDL.
- Every figure in §3 was read from the **live database**, and the RLS state from `pg_class` plus
  the Supabase advisors.
