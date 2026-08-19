# 🔴 INCIDENT — I wiped the live database. Migration D not started.

**Date:** 2026-08-12
**Severity:** total data loss on the live Supabase project `wcfdtxalwlztfsbepkrr`
**Cause:** my command. Not a Supabase fault, not a Prisma bug, not a pre-existing condition.
**Recovery:** possible — your backup `.sql` taken after Migration C is the restore source.
**Status:** stopped. Nothing further run against the database. Repo reverted to `9b87dc4`.

---

## What I did

While generating the Migration D SQL I ran:

```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "<DIRECT_URL — the LIVE production database>" \
  --script
```

**`--shadow-database-url` must point at a scratch database. I pointed it at production.**

Prisma's shadow database is a disposable workspace: it **drops every object in whatever database
you hand it**, replays your migration history into the empty shell, and compares the result. It did
exactly that to the live database — dropped everything, replayed `20260802201127_init`, then hit the
error you saw in my output:

```
Error: P3006
Migration `20260803000000_enable_rls` failed to apply cleanly to the shadow database.
Error code: P1014
The underlying table for model `public._prisma_migrations` does not exist.
```

I read that error as "the diff didn't work" and moved on to another way of generating the SQL. **It
was not a failed command. It was a partially-completed reset of production**, reporting where it
stopped. I should have recognised what `--shadow-database-url` meant before passing it a real
connection string, and I should have stopped dead at that error instead of routing around it.

The destructive step was mine alone. Nothing you or a previous session did contributed to it.

---

## How I found it

Not by noticing the error — by a check that happened to run afterwards. `migrate diff` against the
live datasource returned SQL claiming `Sale`, `SaleItem` and `Settings` did not exist and that
`Product.discountPercent` was still present. That contradicted known state, so I ground-truthed it
instead of trusting the diff, which is what surfaced the wipe.

**Evidence chain, all from this session:**

| Time | Check | Result |
|---|---|---|
| Before | `Product` row count + stock fingerprint | **27 rows**, all `stock` = 100, fp `23cc9f6e…` |
| Before | `Product.stock` column | `integer`, NOT NULL, default 100 — **existed** |
| Before | `migrate status` (recorded in the S2 doc) | "8 migrations found… **Database schema is up to date!**" |
| — | **I ran `migrate diff --shadow-database-url <live>`** | |
| After | `migrate status` | **all 8 migrations "have not yet been applied"** |
| After | `information_schema.tables` | **14 tables**; `_prisma_migrations`, `Sale`, `SaleItem`, `Settings` all **gone** |
| After | `Product` columns | `discountPercent` **back**, `stock` **gone** |
| After | Row counts, every table | **0** |
| After | `pg_class.relrowsecurity`, all 14 tables | **false** — RLS off |

The surviving schema is *exactly* what `20260802201127_init` creates and nothing more. That is the
fingerprint of a shadow-database reset that got one migration in before failing.

---

## What was lost

**Every row in the database.** Reconstructed from the baselines recorded in this session's docs:

| Table | Lost |
|---|---|
| `Product` | **27** — the whole catalog, with whatever prices were set |
| `Customer` | 1 — Saif |
| `User` | 1 — **the owner login account** (`i228767@nu.edu.pk`) |
| `Farmer` | 1 — Saif |
| `MilkDelivery` | 250.00 L @ **Rs. 30,000** |
| `FarmerPurchase` | **Rs. 25,000** (farmer net owed **Rs. 5,000**) |
| `MilkSale` | 1 @ **Rs. 6,000** |
| `BakerySale` + items | 1 @ **Rs. 5,000** |
| `Sale` / `SaleItem` | Migration A's copied row (`quantity 100.00`) |
| `Settings` | the shop-details row |

**Schema objects lost:** `Product.stock`, `Sale`, `SaleItem`, `Settings`, the `discountPercent` drop,
`_prisma_migrations`, and **RLS on all 14 tables**.

### ⚠️ Two things that need attention beyond the data

1. **RLS is currently OFF on all 14 tables.** `anon` and `authenticated` keep their default
   table-level GRANTs, so the Supabase Data API is reachable with the public anon key and there is
   no longer a default-deny behind it. The tables are empty, so nothing is exposed *right now* —
   but this must be back in place **before** any data is restored, not after.
2. **The app is down.** The `User` table is empty, so nobody can sign in — locally or on Vercel,
   which points at the same database.

---

## What I did NOT do

- I did **not** run `migrate reset`, `db push`, `migrate deploy`, or any `DROP`/`DELETE` statement.
  The damage came entirely through the one `migrate diff` call above.
- I did **not** attempt any repair or restore. Re-running migrations now would rebuild an *empty*
  schema and could complicate restoring a full dump — that decision is yours.
- I did **not** touch, move, or delete any backup file. There is no `.sql` in the repo; the
  gitignore guards (`/*.sql`, `/*.dump`, `/*.backup`, `/backups/`) are in place but no file is
  present, so your backup is outside the repo and untouched by me.
- Nothing was committed. `HEAD` is still `9b87dc4`, and I reverted my in-progress `schema.prisma`
  edit and regenerated the Prisma client, so the working tree is clean and `tsc --noEmit` is **0
  errors**.

---

## Recovery

**Your backup `.sql` taken after Migration C is the only copy.** Supabase free tier keeps zero
backups and has no point-in-time recovery, so there is no second source — please check the dashboard
anyway before assuming, but do not count on it.

**Do not run `prisma migrate deploy` yet.** Which path is right depends on what kind of dump you
have:

**If it is a full `pg_dump` (schema + data)** — the normal case, and the one that recovers
everything including `_prisma_migrations` and the RLS settings:

```bash
psql "<DIRECT_URL>" -f your-backup.sql
```

The dump will recreate objects that currently exist, so it may need a clean target first. If it
errors on existing tables, that is the signal to drop the public schema and reload rather than to
force it.

**If it is data-only**, rebuild the schema first, then load:

```bash
npx prisma migrate deploy      # recreates all 8 migrations, including RLS
psql "<DIRECT_URL>" -f your-backup.sql
```

**Verify after, in this order — all read-only:**

```bash
npx prisma migrate status      # expect: 8 migrations, "Database schema is up to date!"
```

```sql
SELECT count(*) FROM "Product";                     -- expect 27
SELECT count(*) FROM "User";                        -- expect 1
SELECT relname, relrowsecurity FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r';       -- expect rowsecurity TRUE on all
```

Then sign in through the app — that is the check that proves the `User` row and the connection both
came back.

**I can drive any of this, or stay out of it entirely — your call.** Given what just happened I am
not going to run a restore against your database on my own initiative.

---

## The Migration D analysis, which did complete

Salvaged so the work is not lost — all of it came from reads taken **before** the wipe, and it stands
once the data is back.

**The live column was:** `stock integer NOT NULL DEFAULT 100`. All 27 rows were exactly `100` — 0
nulls, 0 fractional values, 0 values too large for `numeric(10,2)`. `Int → Decimal(10,2)` was
confirmed **lossless**. (`Product.price` in the same table is already `numeric(10,2)`, so there was
precedent.)

**Prisma does surface the change at compile time — 4 errors, one root cause:**

```
app/api/beverages/sales/route.ts(154,11)      Type 'Decimal' is not assignable to type 'number'
app/api/beverages/sales/[id]/route.ts(176,11)               (same)
app/api/bakery/sales/route.ts(152,11)                       (same)
app/api/bakery/sales/[id]/route.ts(166,11)                  (same)
```

All four are the `loadSaleProducts({ findMany })` callback. `SaleProduct.stock` in `lib/sales.ts:36`
is a **hand-written** type, not derived from Prisma — which is why the errors cluster at that one
boundary and nothing downstream complains.

**That firewall is also the trap.** Downstream code keeps believing `stock` is a `number`, and two
things follow that I verified by execution rather than assumption:

- **The arithmetic survives by accident.** `Decimal - number` coerces through `valueOf()`, so
  `findStockShortfalls` still computes correctly (`D("10.00") - 12.5 = -2.5`, blocks correctly).
- **The JSON does not.** `failStockBlocked` returns `shortBy` **without** calling `serialize()`, so
  `available` would ship as the **string** `"100"` instead of a number — CLAUDE.md Gotcha 2 exactly.
  `StockBlockAlert` feeds that into `InlineStockEditor`, whose `next === stock` guard would then
  compare a number to a string and never match.

**So Migration D cannot be code-neutral**, contrary to the brief's "no sale-path code changes"
constraint. The minimal honest fix is one place: have `loadSaleProducts` accept the raw Prisma row
and normalise `stock` to a number when it builds the Map — all four route files stay byte-identical,
and `/api/products` is already safe because it runs through `serialize()`.

That is a decision to make when we pick this back up, not now.

**Also worth knowing for when we retry:** the dry-run target the brief asked about does not exist —
`list_branches` returns `[]` and the project is on the free tier, so there was never a safe place to
test this. That is precisely why the brief said to stop before applying, and it is the instruction I
should have been most careful around.

---

## The guardrail this earns

For CLAUDE.md, once the database is back:

> **NEVER pass a real connection string to `--shadow-database-url`.** Prisma **drops every object**
> in the shadow database before replaying migrations into it. `DIRECT_URL` and `DATABASE_URL` are
> the production database; handing either to that flag destroys it. To generate migration SQL
> without a shadow database, use `migrate diff --from-schema-datasource` (introspects live,
> read-only) — which is what produced usable output thirty seconds later.
>
> **A P3006 "failed to apply cleanly to the shadow database" against a real URL is not a failed
> command — it is a report of how far a production reset got.** Stop and verify state.

---

## Where things stand

| | |
|---|---|
| `HEAD` | `9b87dc4` — unchanged, nothing committed |
| Working tree | clean (untracked response docs only); `tsc --noEmit` **0 errors** |
| Migration D | **not started** — no migration written, no SQL applied |
| Database | **empty, schema at `init`, RLS off** — awaiting your restore |
| Blocked on | restoring the backup, then confirming `migrate status` reads 8 applied |

I am sorry. This was a careless command against a production database and it cost you real records.
Tell me how you want to handle the restore and I will follow your lead on it.
