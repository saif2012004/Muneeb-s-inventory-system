# The receipt reads the live tables. It is correct as built — and I can prove which tables are live.

**Date:** 2026-08-10
**Status:** ⏸️ Receipt still uncommitted, awaiting your call. `loadReceipt` **not** changed — changing
it as instructed would break it.

Your question 1 was the right one to ask, and the answer decides everything: **`loadReceipt()` reads
`BeverageSale` / `BakerySale`, and those are the tables the live app uses.** So the receipt is
correct, and per your own item 3 we are clear to commit.

I know that conflicts with the premise of the brief. Below is the evidence, including the checks
designed to prove *me* wrong.

---

## 1. I looked for the ways I could be mistaken first

If a unified `/sales` flow exists, it has to live somewhere. It does not live here:

| Where it could be | Command | Result |
|---|---|---|
| Another branch | `git branch -a -v` | **only `main`** (+ `origin/main`, 7 commits behind) |
| A stash | `git stash list` | **empty** |
| Another worktree | `git worktree list` | **one** — this directory |
| Any commit ever, on any ref | `git log --all --oneline --name-only -- "app/api/sales/*" "app/(dashboard)/sales/*" "app/sales/*"` | **no output** — across all 52 commits |

So no unified sale route has ever existed in this repository's history, on any ref.

---

## 2. Every route file in `app/` — the complete list

`find app -name "route.ts" -o -name "page.tsx"` returns 48 files. The sale-related ones are:

```
app/(dashboard)/beverages/page.tsx            app/api/beverages/sales/route.ts
app/(dashboard)/beverages/new-sale/page.tsx   app/api/beverages/sales/[id]/route.ts
app/(dashboard)/bakery/page.tsx               app/api/bakery/sales/route.ts
app/(dashboard)/bakery/new-sale/page.tsx      app/api/bakery/sales/[id]/route.ts
app/(dashboard)/milk/sales/page.tsx           app/api/milk/sales/route.ts
```

**There is no `app/(dashboard)/sales/`, no `app/sales/`, and no `app/api/sales/`.** `/sales` returns
404 because the route does not exist — nothing to redirect *to*, and nothing in `/beverages` or
`/bakery` redirects anywhere (both render `<SalesList module={…} />` directly).

---

## 3. `SALE_DETAIL_SELECT` — every call site, and what precedes it

You flagged this as the thing that misled the earlier read. It is worth settling exactly, because
the name really is misleading:

| File | Line | Model on the preceding line |
|---|---|---|
| `app/api/bakery/sales/[id]/route.ts` | 54 | `prisma.bakerySale.findUnique` |
| `app/api/bakery/sales/[id]/route.ts` | 146 | `prisma.bakerySale.update` |
| `app/api/bakery/sales/route.ts` | 214 | inside `tx.bakerySale.create` |
| `app/api/beverages/sales/[id]/route.ts` | 53 | `prisma.beverageSale.findUnique` |
| `app/api/beverages/sales/[id]/route.ts` | 156 | `prisma.beverageSale.update` |
| `app/api/beverages/sales/route.ts` | 216 | inside `tx.beverageSale.create` |

**Not one call site uses `prisma.sale`.** The select is generic because `BeverageSale` and
`BakerySale` are column-for-column identical — that is Phase 4's deliberate code sharing, documented
in its own comment — not because it targets the unified model.

And the global check:

```
grep -rn "prisma\.sale\.|prisma\.saleItem\." app lib components   ->  ZERO matches
```

`netLineTotal` appears nowhere in `app/` or `lib/` except a comment in my `lib/receipt.ts`
explaining its absence. Reports still read `SUM("totalAmount") FROM "BeverageSale" / "BakerySale"`
(`lib/reports.ts:384-390`) and `prisma.{beverage,bakery}SaleItem.groupBy` on `lineTotal` (lines 217,
224).

---

## 4. The database settles it independently of the code

If a unified `/sales` form were live and someone had put a mixed, bill-discounted sale through it,
`Sale` would show it. Here is the entire contents of `Sale` joined to `SaleItem`:

| field | value |
|---|---|
| `Sale.id` | `cmsjh3kly0002uve8ajkvs2ji` — **the same id as the `BakerySale` row** |
| `Sale.createdAt` | **2026-08-07 21:44:53** |
| Migration A ran at | **2026-08-09 15:07:50** |
| `createdAt > migrationA` | **false** |
| Rows | **1 sale, 1 line**, `moduleKey = 'bakery'`, `discountPercent = 0`, `netLineTotal = 5000.00` |

The one row carries the *original's* id and its pre-migration timestamp — it is the copy migration A
made, not something created through an application flow. **A sale created through a live unified
form would have a fresh cuid and a `createdAt` after 15:07 on 2026-08-09. There is no such row**, and
no row with two different `moduleKey` values, which is what a mixed sale would look like.

---

## 5. Why I did not "fix" `loadReceipt` to read `Sale`

Item 2 says: if it reads the old tables, fix it to read the unified ones. **Following that would
have broken the receipt**, so I stopped instead:

- `Sale` contains exactly **one** row — the migrated copy of Saif's sale.
- Every sale the owner can actually create goes to `BeverageSale` / `BakerySale`, because those are
  the only creation paths that exist.
- So a receipt reading `Sale` would print **that one migrated sale and nothing else**. Every sale
  made from `/beverages/new-sale` or `/bakery/new-sale` — including one created five minutes from
  now — would 404 on its own receipt.

That is the precise inverse of the failure the brief was trying to prevent, and it is not a change
worth making on a premise I could not verify. It is also cheap to reverse if I am wrong: swapping the
two `findUnique` calls in `loadReceipt()` is a five-line edit, and everything downstream already
consumes a `ReceiptData` shaped like a unified sale.

I also could not run the re-verification as written — "print a sale created through the actual
`/sales` form" — because the form does not exist to create one from. What I *did* verify last turn
stands: a real multi-line sale with a **12.5% per-line and 10% whole-bill discount**, created
through the API the app really uses, printed with correct alignment and totals matching the stored
record to the paisa.

---

## 6. The CLAUDE.md note — written, but with the content inverted

You asked for a note saying the unified `Sale` is the live model and `SALE_DETAIL_SELECT` targets
the unified tables. **I could not write that: the code says the opposite, and CLAUDE.md is what a
cold session trusts before it reads any code.** A note claiming the unified tables are live would
send the next session to build on tables nothing populates — the same class of error the process
rule at the top of the file exists to stop, pointed the other way.

So I wrote the accurate version, which serves the same goal — *stop the next session misreading the
sale tables* — in **both** directions. New section, `🧭 WHICH SALE TABLES ARE LIVE`, immediately
above Critical Business Rules:

- The state, plainly, with a table of what each path actually hits.
- **A 10-second self-check, with instructions to run it before asserting either state:**
  `grep -rn "prisma\.sale\.\|prisma\.saleItem\." app lib components` — zero matches means dormant;
  any match means the switch-over happened and the section must be updated in the same commit.
- **The `SALE_DETAIL_SELECT` trap called out by name**, with the reason for the generic name
  (identical table shapes, Phase 4 sharing) and the instruction to grep the call sites rather than
  infer from the name.
- **Why the old tables persist — the pre-Migration-B rollback — stated as correct**, which is the
  part of your note that is unambiguously right and worth recording.

If the switch-over really has shipped somewhere I cannot see, that section is one grep away from
being corrected, and the correction is a two-minute edit.

---

## 7. What would change my mind in one message

This is the fifth turn where a brief describes work that this repository and this database do not
contain, and I would rather break the pattern than keep re-litigating it. Any one of these settles
it:

1. **The output of `grep -rn "prisma\.sale\." app lib components`** run wherever you are looking. If
   it returns matches, we are on different code and that is the real problem to solve.
2. **A screenshot of `/sales` working**, with the URL bar visible.
3. **`git log --oneline -5`** from that environment. Mine ends at `d471340`.

If it is a different environment, that also explains the "5 sales / 3 customers" thread from
earlier today, and it must be resolved before Migration B is ever run — dropping the old tables in
an environment whose contents I have never seen would destroy the only reconcilable copy.

---

## 8. State

| | |
|---|---|
| Receipt | **built, browser-verified, uncommitted** — unchanged since your review |
| `loadReceipt` | **unchanged** — reads `BeverageSale` / `BakerySale`, the live tables |
| Sale code | **untouched**, as instructed |
| Migration B | not written, not run |
| Dev server | **stopped** — 0 listeners on 3000/3001 |
| CLAUDE.md | precision-split note (last turn) + the new sale-tables section — **uncommitted** |

Per your item 3, the receipt reads the live source and is correct, so I am ready to commit it on
your word — or to re-point it at `Sale` in five lines the moment the switch-over is real.

---

### Sources used

**This repository and the live database only.** `git branch/stash/worktree/log`, `find` over `app/`,
`grep` over `app`/`lib`/`components`, and SQL against project `wcfdtxalwlztfsbepkrr` via the
Supabase MCP. No Context7 lookup — every question this turn was about what this codebase does, not
about a library API.
