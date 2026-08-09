# CLAUDE.md housekeeping: snapshot rule hardened, three real drifts fixed, open-items list rebuilt

**Date:** 2026-08-10
**Status:** ✅ Docs committed. No code, no schema, no migration touched.
**Scope note:** items 2 and 4 done in full. Item 1 done, **but not with the wording you gave** —
two of its three bullets describe behaviour the code does not have. Item 3's check is below and it
does not confirm what it was expected to confirm.

---

## The thing to read first

Your framing was: *"The code is correct; the file lags. Fix the file to match reality."*

**That is exactly right as a principle, and it is why I could not write two of the three bullets.**
Documenting the hardened behaviour as *current* would have put a confident, specific, wrong
instruction into the one file a cold session trusts before it reads any code — which is the drift
we are closing, pointing the other way.

Checked against `lib/sales.ts` and the live database this session:

| Item 1 bullet | True today? | What the code actually does |
|---|---|---|
| Reconciler matches by **stable line ID**, never array index | ✅ **TRUE** | `currentById = new Map(existing.map(l => [l.id, l]))`. Documented hard, as asked |
| Quantity-only change does **not** re-price | ✅ **TRUE** | `productChanged` is the only re-price predicate; quantity is deliberately absent |
| Line changes are **delete+add**, no in-place product swap | ❌ **FALSE** | `lib/sales.ts:472` — `const productChanged = prior.productId !== line.productId` is an in-place swap that re-snapshots the price on the SAME line id |
| Server re-snapshots from the DB, **never trusts a client price** on update | ❌ **FALSE** | `lib/sales.ts:475` — `line.unitPrice !== undefined ? new Prisma.Decimal(line.unitPrice) : …`. The client price wins, and `NewSaleForm.tsx:218` **always sends one** |

So I wrote the true version and recorded the rest as a decision that still needs code.

---

## 1. Snapshot rule — what went into CLAUDE.md

The existing table was already accurate, so it stayed (with the swap row clarified as *in place*).
Three things were added around it:

**🔒 A load-bearing block on stable-line-id matching**, marked do-not-simplify, with the failure
mode spelled out concretely rather than as a warning — because "don't use index matching" is not
persuasive on its own, and the specific failure is:

> Delete a line from the MIDDLE of a bill. Every line below the gap shifts up one, gets compared
> against a different stored line, reads as "productId changed", and **re-snapshots at today's
> catalog price** — silently moving the total of a closed sale the owner only opened to delete one
> row from.

The two id guards that go with it are documented as part of the contract: duplicate id → 400,
unknown id → 409.

**⚠️ An explicit "one un-hardened edge" subsection** naming the client-price override as *current
behaviour*, why it exists (the seed ships all products at `price 0`, so the owner must be able to
bill a real price before pricing the whole catalog), and why that reason **only applies to create**.
It records your decision as **DECIDED, NOT YET IMPLEMENTED**: keep the override on create, drop it
on update, one change in the update branch of `reconcileSaleLines()` — with an instruction to fix
the table's last row in the same commit as that code. It is item #7 on the new open-items list.

**The discount contrast**, which was in the code comments but not in CLAUDE.md: a product swap
re-snapshots the **price** but deliberately **not the discount**, because a discount is a decision
about the bill rather than a property of the product.

### Two more real drifts, found while I was in there

Neither was in your list; both are the same class of problem and both were actively wrong:

| Section | Said | Now says |
|---|---|---|
| **Discounts, russ, eggs** | "Discount variants (20/30/60%) are separate Product records" | Discount is a sale-time %, snapshotted on line + sale; **the 36 variant products were deleted** on 2026-08-09; `Product.discountPercent` is a dead column |
| **Out of scope** | "Physical stock / inventory counts (no stock table)" | **Stock shipped 2026-08-09** — decrement, structured `blockedBy` shortfalls, restore on delete, delta reconciliation on edit |

"Stock is out of scope" was the more dangerous of the two: a cold session reading it would have
refused to touch a feature that has been live for a day.

---

## 2. Process note — added at the TOP of the file

Not buried in the carried-forward notes, because it is a rule about how the file itself is
maintained and it needs to be read before anything else.

> **If a change alters a rule documented here, the CLAUDE.md edit ships in the SAME commit as the
> code. Not "next session", not a docs pass at the end of the phase.**

With the reasoning stated — a cold session trusts this file completely, so **a stale line is worse
than no line: it is a confident, specific instruction to do the wrong thing, and it gets followed** —
and a table of the three drifts (Context7, discount variants, stock), each of which was caught by
accident rather than by process. Ends with the check to run before finishing a task: *did I change
behaviour this file describes? If unsure whether a rule is still true, verify it against the code
before repeating it — including the rules in this file.*

You said twice; it was three times. The third is the one that would have caused real damage.

---

## 3. The live-DB check — run, shown, and it does NOT confirm the post-rework state

Queried against project `wcfdtxalwlztfsbepkrr` (same ref as `.env` `DATABASE_URL` — verified last
turn, so this is the app's own database, not a second one).

```sql
select
 (select count(*) from information_schema.tables
   where table_schema='public'
     and table_name in ('BeverageSale','BeverageSaleItem','BakerySale','BakerySaleItem')) as old_tables_present,
 (select count(*) from "Sale")                        as sale_rows,
 (select count(*) from "SaleItem")                    as saleitem_rows,
 (select count(distinct "customerId") from "Sale")    as distinct_customers_with_sale,
 (select count(*) from "BeverageSale")  as bev_rows,  (select count(*) from "BakerySale")     as bak_rows,
 (select count(*) from "BeverageSaleItem") as bev_items, (select count(*) from "BakerySaleItem") as bak_items;
```

| Expected (from the brief) | Actual |
|---|---|
| Old tables **dropped** | **`old_tables_present = 4`** — all four still exist |
| **5** real sales in unified `Sale` | **`sale_rows = 1`**, `saleitem_rows = 1` |
| Across **3** customers | **`distinct_customers_with_sale = 1`** |
| Old tables empty / gone | `BakerySale = 1`, `BakerySaleItem = 1` — **the app's one real sale still lives in the OLD table** |
| RLS on `Sale` + `SaleItem` | ✅ **the one thing that does check out** |

**RLS, the part that passes:**

```sql
select relname, relrowsecurity, relforcerowsecurity from pg_class c
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and relkind='r';
```

All **17** public tables: `relrowsecurity = true`, `relforcerowsecurity = false`, zero policies.
`Sale` and `SaleItem` are both included — Migration A honoured the "new tables need
`ENABLE ROW LEVEL SECURITY`" rule. Default deny intact, Prisma unaffected.

**Sale integrity, for the row that does exist:** `cmsjh3kly0002uve8ajkvs2ji` / Saif / 2026-08-07 /
Rs. 5,000.00, and `Σ netLineTotal = 5000.00 == totalAmount` ✅. So the invariant you wanted checked
holds — on one sale, not five.

**Migration ledger** (`_prisma_migrations`, 5 rows): `init`, `enable_rls`,
`add_sale_discount_percent`, `add_product_stock`, `unify_sale_tables_part_a`. **No Migration B.**
Nothing has been dropped because nothing has been written to drop it.

I have therefore recorded the **actual** state in CLAUDE.md's new open-items list (#4, #5) rather
than a post-rework state that has not happened. If I had written "old tables dropped, 5 sales
migrated" into the file, the next session would have read it, believed the merge was finished, and
built on top of tables nothing populates.

---

## 4. Open-items list — rebuilt as one indexed section

There was no single list before; the items were scattered through the carried-forward notes. There
is now a **`📋 PRE-HANDOFF OPEN ITEMS`** section, verified against the repo and DB, in four tiers.

**Everything you named was present or has been added:**

| You named | Status |
|---|---|
| Data reset before go-live | ✅ present → now **#2, blocker** |
| `Product.discountPercent` drop + catalog "Discount" column, one change | ✅ present → **#9** |
| Context7 diagnosis | ✅ **CLOSED** — it reconnected on its own, verified live. Also pinned: `/prisma/prisma/__branch__6.19.x` exists, so v6 docs can be requested directly instead of filtering v7 |
| Login POST-only fix (blocks Phase 8) | ✅ present → **#1, blocker** |
| Touch targets | ✅ present → **#10**, with the "fix once in `tabs.tsx`, not piecemeal" instruction kept |
| PWA | ✅ present → **#11** |
| Native date format | ➕ **added — was NOT in the file** → **#12** |
| On-device mobile | ➕ **added — was NOT in the file** → **#13** |

**Five more I added, because they are open and were undocumented as such:**

- **#4 Unified `Sale` build** — not started; Migration A applied, nothing reads the tables
- **#5 Migration B** — not written, not run; gated on #4 being browser-verified
- **#6 `lib/receivables.ts` still sums `BeverageSale` + `BakerySale`** — dormant so harmless today,
  but Migration B would leave it referencing dropped tables. Repoint or delete as part of #5
- **#7 The client-`unitPrice`-on-update hardening** — decided, needs code
- **#8 The UI-less sale `PATCH`** — restated in the list so it is not mistaken for dead code, with
  the reminder that "editing a sale doesn't work" means there is no screen
- Plus the two handoff-infra items already in the file (**#14** continent split — `iad1` vs
  `ap-northeast-2`, the ~1.1s/query floor; **#15** the Data API surface decision)

---

## Commit

```
docs: correct snapshot rule to match code, refresh open-items + process note
```
(the tip of `main` after this turn — `git log --oneline -1`)

Docs only, as instructed — `CLAUDE.md` plus the response files. **`prisma/schema.prisma` and
`prisma/migrations/20260809180000_unify_sale_tables_part_a/` were deliberately left uncommitted**;
they are schema, not docs, and they belong with the unified-sale build (#4) so the migration lands
in the same commit as the code that uses it.

---

## Stopping here, as instructed — one thing to settle before the thermal printout

Nothing is blocked on you for the printout itself. But item 3 is now the **fourth** turn where the
brief describes 5 sales / 3 customers and a completed merge, and the database says 1 sale / 1
customer with the old tables intact and the merge unbuilt.

Last turn I ruled out the obvious explanation: `.env` and the Supabase MCP resolve to the **same**
project ref, so it is not a tooling split. That leaves a genuinely different environment, or a
screen that is not this app. **A screenshot of wherever you see five sales, or the URL in the
address bar, settles it in one message** — and it must be settled before Migration B, which drops
the only copy of the data available to reconcile against.

---

### Sources used this session

**Repository and live database only** — file reads, `git log`, and SQL via the Supabase MCP
(read-only inspection, not an application data path). No library API lookups were needed, so
neither Context7 nor `node_modules` was consulted for one — though Context7 was pinged once to
confirm it is back up, which is how the v6-branch pin was found.
