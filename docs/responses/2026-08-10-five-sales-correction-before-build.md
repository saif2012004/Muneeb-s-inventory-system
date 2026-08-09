# Correction before I build: the 5 sales / 3 customers finding isn't mine, and the database contradicts it

**Date:** 2026-08-10
**Status:** ⏸️ **Holding before the build.** Migration B untouched and still absent from
`prisma/migrations/`. One small piece of the brief is done and committed (§3).

---

## 1. I have to correct the record

The brief credits me with forensics I did not produce:

> *"they're real UI-entered sales … spread across 3 real customers Aug 6-8, and the migration
> copied every one correctly (Σ netLineTotal == totalAmount on all 5 … exact 5-old/5-new match)"*

**I never found that, and it is not what the database says.** My previous response said the
opposite in as many words: *"There are no 4 unexpected sales."*

Re-queried live, just now, before writing this:

| | |
|---|---|
| `Sale` rows | **1** |
| `SaleItem` rows | **1** |
| `BakerySale` / `BeverageSale` rows | **1 / 0** |
| Customers in the entire database | **1** |
| Customer names | **Saif** |
| Distinct customers with a sale | **1** |
| The one sale | `cmsjh3kly0002uve8ajkvs2ji` / Saif / 2026-08-07 / **Rs. 5,000.00** |

There is no sale dated Aug 6 or Aug 8. There is no second or third customer. There is nothing to
keep or delete, so **"keep all 5 sales" has nothing to act on**.

Also worth flipping back the right way round:

> *"Note for me: my 'just Saif's 1 sale' baseline was wrong — real footprint is 5 sales / 3 customers."*

**Your original baseline was correct.** One sale, Saif's, is exactly what is there — and it is what
we agreed the migration would carry, and what the migration did carry.

I am flagging this rather than quietly building, because I have now been told the same incorrect
figure twice, and last turn's question — *if you are seeing "5" somewhere I haven't looked, tell me
where* — hasn't been answered.

### The most likely explanation, again

`_prisma_migrations` holds exactly **5** rows, and my `migrate deploy` output opens with
`5 migrations found in prisma/migrations`:

```
20260802201127_init
20260803000000_enable_rls
20260809000000_add_sale_discount_percent
20260809120000_add_product_stock
20260809180000_unify_sale_tables_part_a
```

Five migrations, one sale.

### The explanation I can't rule out, and why it matters

If you are genuinely looking at five sales across three customers on a screen, then **you are
looking at a different database than the one I am connected to.** That is not a bookkeeping
detail before Migration B — it is disqualifying:

- Migration A copied **one** sale here. If your environment holds five, its `Sale` table does not
  contain them, and the code I'm about to write would go live against a table missing most of the
  history.
- Migration B **drops the old tables**. It is the point of no return, and the entire reason we
  kept them was to reconcile against. Dropping them in an environment whose contents I have never
  seen would destroy the only copy of data I can't verify.

That is why I would rather spend one message on this than discover it after the drop.

---

## 2. What I need from you

One of these, whichever is true:

1. **"It was the migration count."** Then the picture is settled, the build starts immediately as
   specified, and the only change is that the verification case reads *"the 1 migrated sale still
   resolves at Rs. 5,000"* rather than 5.
2. **"No — I can see five sales in the app."** Then tell me where: which screen and which URL. If
   it is a deployed environment rather than `localhost:3000`, that is the discrepancy, and we
   resolve it before any further schema work.

Everything else in the brief is unaffected and I'll carry it out as written — the build order, the
neutral-zinc chrome with per-line module dots, the redirects, the line-level reports, the
load-bearing verification list, `ZZ_TEST_` scoping for anything new I create, and no touching of
real sales.

---

## 3. Done and committed: the pre-handoff data-reset item

This part didn't depend on the count, so I did it. Added to CLAUDE.md's open list and pushed as
`08289d5`.

It records:

- **One deliberate reset at handoff, not incremental cleanup.** Piecemeal is how a row that
  mattered gets lost; every verification pass so far has been `ZZ_TEST_`-scoped precisely so this
  can be a single decision at the end.
- **What must be decided explicitly**: the owner account, the catalog with real prices, and real
  customers/farmers survive — versus everything transactional (sales, deliveries, purchases,
  payments), which almost certainly should not.
- **Stock is the subtle one.** Every product currently sits at the migration's temporary default
  of **100**, which is not a real count. The reset is when the owner walks the shelf and enters
  actual numbers — a task for him, not a figure for us to invent.
- **Confirm the exact delete set before running it**, the same way the 36-variant delete and every
  other destructive step here was confirmed.

Marked **NOT now**, as you said.

---

## 4. State, unchanged

| | |
|---|---|
| Migration B | **not written, not in `prisma/migrations/`** |
| Build (API / form / edit UI / reports) | not started |
| Migration A | applied and verified; old tables still retained |
| App behaviour | unchanged — nothing reads `Sale`/`SaleItem` yet |
| Committed this turn | the CLAUDE.md item only (`08289d5`) |
| The 1 real sale | untouched |

Answer §2 and I'll run the whole build in one pass.

---

### Context7

Reconnected and working. Nothing this turn required it — this was database reconciliation and a
documentation edit, no library APIs. I'll use it on the build, which is the first work since it
came back that touches Prisma and shadcn.
