# S9 — retiring the old per-module sale path, then Migration B

**Date:** 2026-08-18
**Status:** 🟠 **RECON DONE — NOTHING CHANGED. I need four decisions from you before writing any code.**
**Nothing destructive has been run.** Every number below came from read-only queries and greps.

---

## The good news first: no data is at risk

Both of your real sales already live in **two** places. Migration A and S5 copied them into the
unified `Sale` table, keeping the **same id** — which is why the app has a de-duplication filter
(`notAMigrationCopy()`) so they aren't counted twice.

| Table | Rows | What's in them |
|---|---|---|
| `BeverageSale` / `BeverageSaleItem` | **0 / 0** | empty — nothing was ever sold through it |
| `BakerySale` / `BakerySaleItem` | **1 / 1** | your Rs. 5,000 bakery sale — **already in `Sale`, same id** |
| `MilkSale` | **1** | your Rs. 6,000 milk sale — **already in `Sale`, same id** |
| `Sale` / `SaleItem` | **2 / 2** | both of the above |

**So dropping the old tables destroys nothing.** Every rupee is already in the table the whole app
now reads. That is the single most important fact here, and it is why S9 is safe in a way most
"drop table" work is not.

---

## 🔴 Decision 1 — do `/beverages` and `/bakery` disappear, or stay as history?

This is the one with a real trade-off, so I'll be straight about it.

Those two screens can still **create** sales today, on the old path. That's the duplication S9
exists to end. But they're also the only place you can say *"show me just the beverages bills"* —
**the unified `/sales` list filters by date and customer only. There is no module filter.**

| Option | What you get | What you lose |
|---|---|---|
| **A. Delete both screens, and add a module filter to `/sales`** *(my recommendation)* | One sales screen. A "Shop: All / Beverages / Bakery / Milk" dropdown next to the date and customer filters, so every question the old screens answered is still answerable | Nothing, once the filter is in. It's about half a day's work — the API needs the parameter too |
| **B. Delete both screens, no filter** | Simplest, fastest | You genuinely can't isolate one shop's bills any more. I don't recommend this |
| **C. Keep them as read-only history** | Nothing changes for you | Two more screens to maintain, and the nav keeps pointing at pages that can't do the main thing their name suggests. This is the confusion S9 is meant to remove |

**I recommend A.** The filter is the honest replacement — it keeps the capability while removing the
second way to ring a sale.

Either way, the nav goes from **Dashboard · Sales · Beverages · Bakery · Milk Shop · Customers ·
Catalog · Reports** down to **Dashboard · Sales · Milk Shop · Customers · Catalog · Reports.**
Milk Shop stays regardless — it's the farmers, deliveries and balances, which are nothing to do
with this.

---

## 🔴 Decision 2 — does `MilkSale` get dropped too?

**Migration B as originally scoped drops four tables and leaves `MilkSale` alone.** That was written
before the milk cutover, and it now looks like an oversight worth asking about rather than assuming.

If `MilkSale` **stays**: your Rs. 6,000 milk sale lives in two tables forever, the de-duplication
filter has to stay forever, and `/milk/sales` remains as a history-only screen.

If `MilkSale` **goes** (my recommendation): one fewer table, the dedupe filter deletes itself
entirely, and `/milk/sales` retires — the sale is already on `/sales`, tagged Milk. Milk *deliveries*
and *farmer balances* are untouched either way; those are different tables and are not in scope.

**My recommendation: drop it, in the same pass.** Half a cutover is what created the current mess.

---

## 🔴 Decision 3 — before or after the data reset?

Your go-live data reset (checklist #2) will clear the transactional rows anyway.

- **Do S9 first** *(my recommendation)*: the codebase is clean before you start entering real
  records, and the reset afterwards is a smaller, simpler job on a simpler schema.
- **Do the reset first**: then Migration B drops tables that are already empty — marginally safer,
  but it means you spend the run-up to handover on a codebase that still has two sale paths in it.

Either is safe. The difference is sequencing, not risk.

---

## 🔴 Decision 4 — I need a fresh backup, and only you can take it

**`backup3.sql` is now out of date.** It predates today's work: it has no `ProductUnit` table, none
of the 47 new beverage products, and none of the selling units. Restoring it would roll all of that
back.

**Migration B is the point of no return, so the rule is absolute: a verified fresh dump first.**
"Verified" means opened and checked — a known row is in it (grep for `Saif`), it ends with
`-- PostgreSQL database dump complete`, and it contains `COPY` data blocks and not just schema.

Take it with the **session pooler** host, port 5432 — the `db.<ref>.supabase.co` host does not
resolve from your network:

```
pg_dump "postgresql://postgres.<ref>:<password>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres" > backup4.sql
```

Tell me where you put it and I'll verify the contents before anything is dropped.

---

## What I'll do once you answer

Sequenced deliberately: **all the code changes and browser verification first, the `DROP TABLE`
last and on its own.** The old tables stay as the rollback until the moment they can't break
anything.

1. **Retire the write paths** — delete `/beverages/new-sale`, `/bakery/new-sale`, their API routes,
   `NewSaleForm`, `SalesList`, `lib/sale-modules.ts`, `lib/validations/sales.ts`, and the per-module
   hooks. (Depending on Decision 2, `/milk/sales` and `POST /api/milk/sales` go too.)
2. **Repoint the eight route files** that still read the old tables through `lib/receivables.ts`, plus
   `lib/reports.ts`, `lib/receipt.ts` and the CSV exports, to read `Sale` alone.
3. **Delete the de-duplication filter**, which becomes dead the moment there's only one copy.
4. **Add the module filter to `/sales`** (Decision 1A).
5. **Browser-verify everything** — the till, the sale list and its filters, receipts, the customer
   balances, every report figure and every CSV — and check the numbers still match what they say
   today: outstanding 11,000, and the two sales at 5,000 and 6,000.
6. **Then, and only then, Migration B** — shown to you as SQL for approval before it is run, against
   a verified fresh backup, on a database where those tables no longer have a single reader.

Steps 1–5 are fully reversible. Step 6 is not, which is why it's alone at the end.

---

## The short version

If you'd rather not go through it point by point, replying **"do your recommendations"** means:

> Delete `/beverages` and `/bakery`, add a shop filter to `/sales`, drop `MilkSale` along with the
> other four tables, do it before the data reset — and I'll hold at step 6 until you've taken a fresh
> backup and approved the SQL.

**File:** `docs/responses/2026-08-18-s9-retire-old-tables-YOUR-INPUT-NEEDED.md`
