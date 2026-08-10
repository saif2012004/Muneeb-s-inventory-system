# Step 1 — the delete guard: three findings before I change anything

**Date:** 2026-08-11
**Ran:** nothing. No code change, no schema change, no migration, no data change. Read-only greps
and `SELECT`s.
**Why I stopped:** the guard described in the brief doesn't exist in that form, and the rewrite as
specified would **create** the exact bug it's meant to prevent.

---

## Finding 1 — There is no customer-delete guard. Customer deletion checks nothing.

`DELETE /api/customers/[id]` is an **unconditional soft delete**. It reads `Customer` and writes
`isActive = false`. It does not query `BeverageSale`, `BakerySale`, `Sale`, or any sale table at
all:

```ts
// app/api/customers/[id]/route.ts:162
const customer = await prisma.customer.findUnique({
  where: { id: params.id },
  select: { id: true, name: true, isActive: true },
});
if (!customer) return fail("That customer no longer exists.", 404);

const deactivated = await prisma.customer.update({
  where: { id: customer.id },
  data: { isActive: false },
  select: CUSTOMER_SELECT,
});
```

Its own docblock states the design: *"SOFT delete, always. A customer is never hard-deleted, even
with no history."* History is protected **structurally** — a customer row is never removed, so a
sale can never be orphaned. There is no branch to get wrong and nothing pointing at the old tables.

**Consequence for the brief:** there is no customer guard to rewrite, and the failure mode
described — *"silently stop finding history and allow deleting a customer who actually has
history"* — cannot occur, because no history lookup gates the delete in the first place.

A search across the customer path for any guard helper (`hasSaleHistory`, `canDelete`,
`blockedBy`, …) returns nothing.

## Finding 2 — Customer deletion isn't reachable from the UI, so step 1's browser test can't be run as written

The mutation hook exists but has **zero callers**:

```
$ rg 'useDeactivateCustomer' --glob '*.tsx'
(no matches)
```

`lib/hooks/use-customers.ts:202` defines `useDeactivateCustomer`, and no component imports it.
Neither `CustomersHub.tsx` nor `CustomerProfile.tsx` renders a delete or deactivate control — the
only customer URL in the UI is the profile link at `CustomersHub.tsx:264`.

So *"try to delete a customer who HAS a sale → must be refused"* has no button to click. I could
exercise the route over HTTP, but that would be testing an endpoint the owner cannot reach, against
a guard that doesn't exist.

## Finding 3 — The guard that *does* read the old tables is the PRODUCT guard, not a customer one

`lib/catalog-guards.ts` is the single delete-safety implementation for **category, sub-category and
product**. Every query in it is keyed on `productId`:

```ts
prisma.beverageSaleItem.groupBy({ by: ["productId"], where: { productId: { in: productIds } }, … })
prisma.bakerySaleItem.groupBy({  by: ["productId"], … })
prisma.beverageSaleItem.count({ where: { productId } })
prisma.bakerySaleItem.count({  where: { productId } })
```

The word "customer" does not appear in the file. What it protects: a product with sale history is
soft-deleted rather than removed; a sub-category or category with any such product beneath it is
**refused with a 409** and a structured `blockedBy: [{ id, name, saleCount }]`.

**This is a live business rule and you're right that it's the priority** — it is the one guard whose
correctness depends on which sale tables it reads. It is just a product guard, not a customer one.

---

## The reason I did not repoint it: doing so now creates the bug

> The brief's own words: *"…or — worse — silently stop finding history and allow deleting a
> customer who actually has unified-Sale history."*

That risk is real. **But right now it runs in the opposite direction**, because the app writes sales
to the old tables and nothing writes to the unified ones.

If `findProductsWithSaleHistory` and `productHasSaleHistory` were repointed at `SaleItem` today:

| Situation | Guard reading old tables (now) | Guard reading `SaleItem` (proposed) |
|---|---|---|
| Product sold via the live sale form | line exists → **history found, protected** | `SaleItem` has no row → **"no history" → HARD DELETE ALLOWED** |
| Category containing it | refused, 409 | permitted |

**Every sale the app creates lands in `BeverageSaleItem` / `BakerySaleItem` and has no `SaleItem`
counterpart.** I demonstrated exactly this yesterday during the item-#9 verification: a sale created
through the real UI wrote to `BeverageSale` / `BeverageSaleItem`, with nothing in `Sale` / `SaleItem`
(that test data has since been cleaned up).

So repointing the guard before the switch-over would let the owner **hard-delete a product that has
real sales**, taking the `unitPrice` snapshot with it and leaving past bills unreadable — the
precise failure the guard exists to prevent, introduced by making the change early.

### Why today's data looks deceptively fine

```sql
SELECT p.id, p.name,
       (old BeverageSaleItem + BakerySaleItem lines) AS old_table_lines,
       (SaleItem lines)                              AS unified_lines
FROM "Product" p WHERE (any lines) > 0;
```

| id | name | old_table_lines | unified_lines |
|---|---|---|---|
| `prod_buns` | Buns | 1 | 1 |

They agree — **but only because the database currently holds no sale created after Migration A.**
The single sale predates it and was copied, so both sides see it. The columns diverge the moment
the owner records one more sale. A guard verified against this snapshot would pass its test and
still be wrong in production.

---

## What I recommend

**Leave the guard pointing at the old tables until the switch-over, and repoint it as part of
CHECKLIST #4** — the same commit that makes `Sale`/`SaleItem` the tables the app actually writes to.
The guard is correct today precisely because it reads the tables the app uses.

**If you want the guard hardened now, there is a safe version: make it read BOTH.** Union the
counts instead of switching sources:

```ts
const [beverageGroups, bakeryGroups, unifiedGroups] = await Promise.all([
  prisma.beverageSaleItem.groupBy({ by: ["productId"], … }),
  prisma.bakerySaleItem.groupBy({  by: ["productId"], … }),
  prisma.saleItem.groupBy({        by: ["productId"], … }),   // NEW
]);
// existing countsById loop already sums across sources — add the third
```

That is strictly safer than either single source:

- **before** the switch-over it finds history in the old tables (correct today),
- **during** a partial cutover it finds history in either,
- **after** B it needs only the old two branches deleted — no logic change.

It cannot produce a false "no history", which is the only dangerous direction for this guard. The
cost is one extra query on a path that already runs three; the same `countsById` map absorbs it
with no other change. *(Note the `Promise.all` — pre-existing here, and worth flagging against the
`connection_limit=1` rule in CLAUDE.md, though at 3–4 queries it stays within what that note calls
acceptable.)*

**I have not made this change.** It is a deviation from what you asked, on a load-bearing guard, and
it is only worth doing under option 1 below — so it's your call, not mine to assume.

---

## Where B stands

Unchanged from yesterday: **B is blocked on CHECKLIST #4**, not on a guard fix. Steps 2–4 of the
brief still cannot proceed, for the reason in the previous report — 54 live references across 9
files, of which 6 are raw SQL that fails at runtime rather than compile time.

Fixing the guard would not have unblocked B either: the guard is 4 of those 54. The other 50 are the
sale APIs, reports, CSV export, receipts and receivables.

**Two ways forward, unchanged:**

1. **Build #4** — repoint all 9 files onto `Sale`/`SaleItem`, browser-verify, then B. The guard
   (with or without the union hardening above) is repointed inside that work.
2. **Abandon the unification** — drop the dormant `Sale`/`SaleItem` instead. The guard then stays
   exactly as it is, correctly, forever, and the old/new ambiguity closes just as permanently.

---

## Housekeeping

- **Nothing run, nothing changed.** `prisma/schema.prisma` still carries only the one-line
  `discountPercent` removal from item #9; 17 models intact.
- **No `ZZ_TEST_` data created** — this was greps and read-only `SELECT`s. Database unchanged:
  27 products, Saif, 1 bakery sale, 1 milk sale, 1 owner account.
- **Item #9 is still uncommitted** — the migration, 13 code files and the CLAUDE.md updates,
  awaiting your go from three steps back.
- Step 6's instruction — *note in CLAUDE.md that the guard checks the unified Sale so nobody
  repoints it wrong later* — is a good idea and I'd like to write it. It should say what is
  actually true at the time, so it belongs with whichever of options 1 or 2 you choose.

> ⚠️ **"5 real sales" — sixth mention.** There are **2**: bakery Rs. 5,000 and milk Rs. 6,000,
> against the single customer Saif. `BeverageSale` is empty. It matters again here: step 5 asks to
> verify "unified Sale intact with the 5 real sales", and `Sale` holds **1** row — which is correct,
> not data loss.

---

## Awaiting

Step 1 cannot be done as written: there is no customer-delete guard, customer deletion is
unreachable from the UI, and repointing the product guard now would introduce the silent-failure bug
you described. All three are evidenced above.

**Tell me which you want:**

- **A.** Harden `lib/catalog-guards.ts` to check old **and** unified (safe now, safe after B) — I'll
  implement and browser-verify it against product deletion, both cases.
- **B.** Build the #4 switch-over, repointing the guard as part of it.
- **C.** Abandon the unification and drop the dormant `Sale`/`SaleItem` instead.
- **D.** Commit item #9 first — it's been ready and verified for a while.
