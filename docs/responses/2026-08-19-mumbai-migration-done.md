# The database is in Mumbai. Everything verified, nothing lost.

**Date:** 2026-08-19
**Commit:** `097143a`
**Server:** production build running at http://localhost:3000

---

## Result

**Round trip: 226 ms → 96 ms.** Measured 20 samples, warm.

End to end on a production build, same screens, before and after:

| | Seoul | Mumbai |
|---|---|---|
| Reports summary | 237 ms | **135 ms** |
| Settings | 235 ms | **141 ms** |
| Sales list | ~630 ms | **339 ms** |
| Customers | ~630 ms | **343 ms** |
| Catalog / till products | ~1,020 ms | **~490 ms** |
| **Saving a sale** | ~1,600 ms | **~1,330 ms** |

Roughly **2× on reads**. Combined with this morning's pooler fix, the app went from ~1.1 s per query
to 96 ms — about **11× on the underlying round trip**.

Being straight about the save: it improved least (1,600 → 1,330 ms). It is 7 sequential statements
inside one transaction, and each carries fixed overhead beyond raw latency. Further gains there mean
restructuring the write, which I would not do lightly — that is the code guaranteeing stock and money
move together.

---

## How it was verified

**The restore itself:** `pg_dump --schema=public --no-owner --no-privileges` from Seoul, restored with
`psql`. **14 `COPY` blocks, 191 rows, zero errors.** Dumping only `public` is what avoided the
`must be owner of…` flood from the August restore — the new project brings its own `auth`, `storage`
and `realtime`.

**Then I did not trust it.** I fingerprinted **every table on both databases** and compared:

```
Product ✓  ProductUnit ✓  Sale ✓  SaleItem ✓  MilkDelivery ✓  FarmerPurchase ✓
Customer ✓  Farmer ✓  Settings ✓  User ✓  Category ✓  SubCategory ✓

EVERY TABLE IDENTICAL — the copy is exact.
```

Also verified: **RLS on all 14 tables**, FORCE RLS on none · `_prisma_migrations` restored at **12
rows with their original timestamps**, so `prisma migrate status` says *"Database schema is up to
date"* without re-applying anything · your owner login row present · both real sales (5,000 and
6,000) and both farmers intact · the balance sheet rendering Rs. 207,000 exactly as before.

### One alarm I chased down rather than waved away

The documented 27-product fingerprint **did not match**. I did not accept that.

It turned out the constant is stale by design: it includes `stock`, which changes on every sale. The
differences were **Big Apple 0.5L** (a price you set) and **Biscuits Simple / Cake Rusk Premium /
Pepsi 1.5L** (stock moved by your test sales). All of it predates the migration — which the
table-by-table comparison against live Seoul proves independently.

Lesson recorded in CLAUDE.md: to compare two databases, fingerprint **both live and diff them**. A
frozen constant containing mutable columns will always drift.

---

## 🔴 The thing that nearly derailed this, and its symptom lies

After the restore the app returned 500s while **everything else worked**. `psql` connected.
`prisma migrate status` connected. A standalone Prisma script connected and benchmarked at 96 ms.
Only the app failed, with two errors that both point the wrong way:

```
Can't reach database server at `aws-0-ap-south-1.pooler.supabase.com:5432`
Authentication failed ... credentials for `postgres` are not valid
```

I checked DNS (fine), both load-balancer IPs (both reachable), connection counts (2 of 60), and Next
itself (a no-database route answered in 6 ms).

**The cause: your password contains `$` and `&`.** The app reads `.env` through dotenv, which performs
**`$VAR` expansion** — so Next authenticated with a *different* password than the file contains. Every
diagnostic I ran read the file with its own regex and got the true string, which is precisely what
made it so misleading.

**Fixed** by percent-encoding the password (`$` → `%24`, `&` → `%26`) in both URLs. `.env.example` had
warned about this since Phase 1; it now explains *why*, and it is written up as **Gotcha 3d** with the
diagnosis shortcut: *if psql and a standalone script connect but the app cannot, stop looking at the
network and look at the password characters.*

I also fixed your `DIRECT_URL`, which used `db.<ref>.supabase.co` — **that host does not resolve from
your network**, confirmed on 12 Aug and again today. It now uses the pooler host.

---

## 🔴 What you still need to do

1. **Update the Vercel env vars.** They still point at the **old Seoul project on `:6543`**, so
   production has neither the pooler fix nor the region move. Copy `DATABASE_URL` and `DIRECT_URL`
   from your `.env` — **including the percent-encoding**, or production will hit exactly the failure
   above.
2. **Set the Vercel function region to `bom1` (Mumbai)** so the function sits beside the database
   instead of in Washington DC.
3. **Do not delete the Seoul project yet.** It is your rollback and it is untouched. Delete it once
   production is verified on Mumbai — and take a backup first.

**Rollback, if you ever need it:** the Seoul strings are in `.env.backup-20260819`. Note that file has
`DATABASE_URL` on the old `:6543`; switch it to `:5432` if you go back, or you will also lose this
morning's 5×.

---

## Files

| | |
|---|---|
| `E:\Carreer_efforts\mumbai-migration-final.sql` | the dump that was restored — verified, 191 rows |
| `E:\Carreer_efforts\backup5.sql` | your pre-Migration-B backup |
| `.env.backup-20260819` | Seoul connection strings (rollback) |

**File:** `docs/responses/2026-08-19-mumbai-migration-done.md`
