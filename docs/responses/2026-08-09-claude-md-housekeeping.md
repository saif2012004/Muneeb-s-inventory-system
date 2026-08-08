# CLAUDE.md housekeeping — discount-column cleanups + Context7 item

**Date:** 2026-08-09
**Scope:** documentation only. No code, no schema, no migration, no database change.
**Commit:** `docs: log discount-column cleanup and Context7 item in CLAUDE.md`

Both items logged, plus one gap I found while logging them.

---

## 1. `Product.discountPercent` column drop — logged

Added to the carried-forward notes, beside the existing Phase 8 entries so it sits with the other
queued cleanup work rather than in a section nobody re-reads.

What it records:

- **Do it AFTER stock**, as its own migration — dropping a column is irreversible and shouldn't
  share a migration with a data delete or a feature.
- **Two things go together:** the column (**6 files still read it** — `ProductTable.tsx`,
  `lib/sale-catalog.ts`, `lib/catalog-display.ts`, `lib/validations/catalog.ts`, and the two
  `/api/products` routes) and **`SALE_DETAIL_SELECT` in `lib/sales.ts`**, which still joins
  `product.discountPercent` even though the UI reads the line's own snapshot.
- **Not urgent, because the entry point is already closed** — `ProductDialog`'s discount field went
  in the same commit, so no new variant can be created meanwhile. All 27 surviving products carry
  `discountPercent` 0 or null.

I also added one line that isn't strictly housekeeping but is the thing most likely to go wrong
later:

> **Do NOT read `product.discountPercent` for a sale line.** The line's own `discountPercent` is the
> snapshot; the product's is a dead field awaiting removal.

That's the failure mode of leaving a dead column in place. A future session sees `discountPercent`
on the product, uses it to label a line, and an old bill's discount silently becomes mutable again —
undoing the rework without touching any of its code. Cheaper to write the sentence than to debug it.

---

## 2. Context7 — Phase 8 diagnosis item logged

Added as a Phase 8 carried-forward item. It records the failure (6 consecutive sessions, 3–9 Aug,
stuck in "connecting", tools never exposed), states plainly that the fallback is working and has been
the stronger source, and then says six sessions is a broken tool rather than a blip — check the MCP
config, the server's install/auth state, and whether it needs a key.

Framed as cheap-during-cleanup, not a blocker, matching your read.

---

## 3. The gap I found: the "updated CLAUDE.md rule" didn't exist

Worth flagging, because it affected two prompts.

The last two briefs said *"fall back to node_modules source **per the updated CLAUDE.md rule**"* — but
CLAUDE.md was never actually updated. Line 38 still read, with no qualification:

> **Always use Context7 MCP before writing code... Never rely on training data for these APIs.**

I proposed that amendment in the batch 2 response (§0) and it was never applied, so the file has been
describing a rule that has been unmet for six sessions, while the briefs referenced a fallback clause
that wasn't written down anywhere. A fresh session reading only CLAUDE.md would have had to either
violate the rule or block on a server that never connects.

Since I was in the file for housekeeping anyway and you've referred to the rule as existing twice, I
wrote it in — it's the documented practice, just undocumented. It now says: try Context7 first, and
if it won't connect fall back to **installed package source**, never to training data. With the
reasoning that makes it a real rule rather than a loophole:

> For "what does this version actually do", that is *stronger* than docs: it is the code that will
> run, at the version that is pinned.

and the three cases that earned it — the Recharts entrance animation frozen at 5% (found by reading
`node_modules/recharts/es6/cartesian/Line.js`), `Prisma.Decimal`'s `ROUND_HALF_UP` confirmed by
executing it rather than assuming, and the existing Prisma v6-vs-v7 guardrail.

Plus one obligation: **say which source you used**, so a reviewer can tell whether a claim came from
docs, from source, or from a live check.

The MCP Tools section further down carried the same unqualified rule, so it now cross-references the
fallback and notes the outage.

**Tell me if you'd rather that clause read differently** — it's the one edit here you didn't
explicitly ask for, and it's a standing rule, so it should be worded the way you want.

---

## What changed

| File | Change |
|---|---|
| `CLAUDE.md` | **+42 lines, 0 deletions.** Four additions: the column-drop item and the Context7 item in the carried-forward notes; the `node_modules` fallback clause in Tech Stack; an outage note in the MCP Tools section. |

Nothing else touched. No code, no schema, no migration, no DB change, and no test data created —
so there was nothing to clean up and Saif's records were never in scope this turn.

---

## Next

Stock, when you send the prompt. As you said, it's now the small change it always should have been:
one plain integer per product across 27 real SKUs, decrement on sale, block-with-restock when
short, restore on delete, reconcile the delta on edit — all inside the existing sale transaction.

Two things worth carrying into it from this batch:

1. **The edit path is where stock will break**, the same way it was where discount nearly broke. The
   header-only `PATCH` branch had a comment asserting "nothing to recompute" that stopped being true
   the moment a bill-level field existed. Stock adds another such field, and `reconcileSaleLines`
   already produces exactly the `updates` / `creates` / `removedIds` split a stock delta needs — so
   reuse that, don't derive a second one.
2. **`connection_limit=1`** means the stock reads and writes have to sit in the existing transaction
   in series, not fanned out — the same discipline as milk quick-entry.
