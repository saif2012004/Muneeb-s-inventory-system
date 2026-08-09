# Snapshot asymmetry: verified, all three cases. Migration B: not run.

**Date:** 2026-08-10
**Status:** ⏸️ **Migration B NOT run and NOT written.** The old tables are intact.

Your actual question — *did "preserve the snapshot" overcorrect into "edits can never re-price a
genuinely changed line"?* — is answered below with numbers. **It did not.** All three cases behave
correctly.

But I can't act on the "GO on Migration B", and I need to explain why.

---

## 1. The build the go is predicated on does not exist

The brief opens by describing work I have not done:

> *"building the 10%-discount mixed sale with a paisa-splitting total (residue on the largest line,
> modules summing to 1,530.00 exactly)"* … *"both bugs are real ones the build couldn't see"* …
> *"the stale-price fix"*

None of that happened. I stopped before the build in each of the last two turns, waiting on the
5-vs-1 question. Verified against the repository just now:

| | |
|---|---|
| Last commit | `08289d5` — the CLAUDE.md doc item |
| Last **code** commit | `d0ed825` — stock tracking |
| `/sales` route | **does not exist** (`app/(dashboard)/`: bakery, beverages, catalog, customers, milk, reports) |
| Unified sale API | **does not exist** (`app/api/`: per-module routes only) |
| Working tree | `prisma/schema.prisma` modified + untracked response docs + Migration A. **No new code.** |

There was no mixed sale, no 1,530.00 reconciliation, no two bugs, and **no stale-price fix** —
which matters, because the thing you asked me to check for overcorrection was never changed. The
asymmetry has been in `reconcileSaleLines` since Phase 3.1 and is untouched.

The database also still reads as it has all along: **1 sale, 1 customer (Saif), Rs. 5,000.**

---

## 2. Why I will not run Migration B

Migration B drops `BeverageSale`, `BeverageSaleItem`, `BakerySale` and `BakerySaleItem`. You
described it yourself as the point of no return, and gated it on the new flow being fully verified.

**The new flow does not exist yet, so it cannot have been verified.** Nothing reads `Sale` or
`SaleItem` — the app is still running entirely on the old tables. Dropping them now would delete
the tables the live application is using, and take with them the only copy that can be reconciled
against.

Running it because a "go" arrived would be doing the destructive thing on the strength of a
verification that never happened. That is exactly the failure the two-part split was designed to
prevent.

---

## 3. What I *could* answer, and did: the snapshot asymmetry

This part needed no new code. The rule lives in `reconcileSaleLines`, which is shared, implemented
and already server-verified — so I exercised all three cases against the real PATCH route over
HTTP.

**Fixture:** catalog prices set to Coke `40.00`, Pepsi `70.00`. A sale created **without** sending
`unitPrice`, so the server snapshotted the catalog price. Then both catalog prices moved sharply —
Coke → **999.00**, Pepsi → **555.00** — so any re-pricing would be unmissable.

| Case | Action | `unitPrice` after | Expected | Result |
|---|---|---|---|---|
| **(a)** | quantity 10 → 6, product unchanged | **40.00** | keep the snapshot | ✅ kept 40.00 while the catalog said 999.00 |
| **(b)** | swap the line's product Coke → Pepsi | **555.00** | re-snapshot to Pepsi's current price | ✅ re-priced to 555.00 |
| **(c)** | add a new Coke line | **999.00** | current catalog price | ✅ took 999.00 — *and the existing Pepsi line kept its own 555.00* |

Case (c) is the one that proves the two behaviours coexist in a single save: one line re-priced,
another held its snapshot, in the same request.

So the asymmetry is intact and exactly as intended:

```
quantity changed, same product  ->  KEEP the stored unitPrice
product swapped on a line       ->  RE-SNAPSHOT to the new product's current price
new line added                  ->  current catalog price
explicit unitPrice sent         ->  that value wins over all of the above
```

And the deliberate contrast with discount is also untouched: a **product swap re-snapshots the
price but NOT the discount**, because a discount is a decision about the bill rather than a
property of the product. That is in the code and commented as such.

Nothing overcorrected. There was no correction to over-apply.

---

## 4. Test data: cleaned up, everything restored

Everything I created was `ZZ_TEST_`-scoped, and the sale was deleted **through the API** so the
app's own logic restored stock.

| Check | Result |
|---|---|
| Products | **27** |
| Products at `stock = 100` | **27** |
| Products with a non-zero price | **Big Apple 0.5L = 120.00** only — the pre-test state |
| `ZZ_TEST` customers left | **0** |
| Customers | **1 — Saif** |
| `Sale` rows / total | **1 / 5000.00** — untouched |
| `BeverageSale` / `BakerySale` | **0 / 1** — still present |
| Milk (sales / deliveries / purchases) | **1 / 1 / 1** |

The two real products I moved (`prod_coke_cola_1_5l`, `prod_pepsi_1l`) are back to price `0.00`
and stock `100`. The one real sale was never touched.

---

## 5. What I need from you

We are three turns into a loop where the brief describes a state the database and the repository
do not show, and it has now escalated from a phantom row count to a go-ahead for an irreversible
migration. I would rather break that loop than keep answering inside it.

**One question, and it determines everything else:**

> Are you looking at `http://localhost:3000` on this machine, or at a different
> environment/database?

If it is a different one, that explains all three turns at once — the 5 sales, the completed
build, the bug fixes — and it means Migration A ran here while the work you are reviewing lives
somewhere else. That must be resolved before any table is dropped anywhere.

If it is the same one, then something is reporting to you a state that neither the database nor
git reflects, and I would like to see it.

**Once that is settled, I will run the build in one pass, exactly as specified:** unified API
reusing `reconcileSaleLines` / discount / stock unchanged, the `/sales` form and edit UI with
neutral-zinc chrome and per-line module dots, old routes redirecting, reports rewritten to
line-level `Σ netLineTotal` by `moduleKey` — then the full browser verification including the
mixed bill and the exact module-split reconciliation on a bill-discounted sale. Migration B after
you have seen all of it.

---

### Context7

Connected and working. Not needed this turn — no code was written; this was HTTP-level behaviour
verification and database queries. It will be used on the build.
