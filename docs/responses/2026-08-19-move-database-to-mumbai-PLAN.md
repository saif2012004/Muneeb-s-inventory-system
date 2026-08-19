# Moving the database to Mumbai — plan, and the two things only you can do

**Date:** 2026-08-19
**Status:** 🟠 **prep done, waiting on you.** Nothing has changed yet. Seoul is untouched and serving.

---

## Why this is worth doing

Every database round trip currently costs **230 ms** — that is pure distance to Seoul
(`ap-northeast-2`, ~5,000 km). Mumbai (`ap-south-1`) is ~1,300 km from Lahore.

| | Seoul (now) | Mumbai (expected) |
|---|---|---|
| One round trip | 230 ms | **~50 ms** |
| Saving a sale (7 trips) | ~1.6 s | **~0.35 s** |
| Sales list (2 trips) | 245 ms | **~100 ms** |

**It speeds up your local development too**, unlike moving the Vercel function — your dev server
talks straight to the database from Pakistan.

---

## ✅ What I have already done (safe, nothing changed)

**Taken and verified the migration payload:** `E:\Carreer_efforts\mumbai-migration-20260819.sql`

I verified it **by contents**, not by existence — the rule that saved this project in August:

| Check | Result |
|---|---|
| Ends with `PostgreSQL database dump complete` | ✅ not truncated |
| `COPY` data blocks | **14** |
| Rows | **191** — Product 75, ProductUnit 60, SaleItem 7, Sale 5, SubCategory 20, Category 3, Farmer 2, MilkDelivery 2, FarmerPurchase 2, Customer 1, Settings 1, User 1, `_prisma_migrations` 12 |
| Known real data | Saif, `prod_milk`, `prod_eggs`, the settings row — all present |
| `ENABLE ROW LEVEL SECURITY` | **14 tables** — security travels with the data |
| `DROP DATABASE` / `DROP SCHEMA` | **0** — it cannot harm the target |
| `CREATE TABLE` | **14**, matching live exactly |

**Two findings that make this far simpler than it could have been:**

1. **Only two env vars point at Supabase** — `DATABASE_URL` and `DIRECT_URL`. There is no Supabase
   JS client, no anon key, no service key anywhere in the code. It is Prisma-only, so the move is
   *dump → restore → swap two strings*.
2. **All five extensions are Supabase defaults** (`pg_stat_statements`, `pgcrypto`, `plpgsql`,
   `supabase_vault`, `uuid-ossp`). A fresh project already has them. Nothing app-specific to rebuild.

I dumped **only the `public` schema**, deliberately. A full dump drags in Supabase-internal schemas
owned by roles we cannot recreate, which is what produced that flood of `must be owner of…` errors
during the August restore. The new project brings its own `auth`, `storage` and `realtime`.

---

## 🔴 What only you can do

The Supabase tools I have are scoped to your *existing* project and cannot create a new one.

### Step 1 — create the project

Supabase Dashboard → **New project**

| Field | Value |
|---|---|
| Organisation | the same one |
| Name | something like `muneeb-inventory-mumbai` |
| **Region** | 🔴 **South Asia (Mumbai) — `ap-south-1`** |
| Database password | a new strong one — **save it** |

> ⚠️ The free tier allows **two active projects**. If you are already at the limit the new one will
> not start; pause the old project only *after* we have verified the new one, never before.

### Step 2 — give me the connection strings

Dashboard → **Project Settings → Database → Connection string → Session pooler**.

Add these two lines to `.env` yourself (it is gitignored, so the password stays off the transcript
and out of git). **Keep the existing `DATABASE_URL` and `DIRECT_URL` exactly as they are** — they are
the rollback.

```
NEW_DATABASE_URL="postgresql://postgres.<new-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?connection_limit=5"
NEW_DIRECT_URL="postgresql://postgres.<new-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

**Port 5432 on both — the session pooler.** That is the lesson from this morning: `:6543` adds ~950 ms
per query. Copy the host exactly as the dashboard shows it (the `aws-0`/`aws-1` prefix varies).

Then say go.

---

## What I will do once you do

1. **Restore** the verified dump into Mumbai.
2. **Verify by contents, before trusting it** — row counts against the 191 above, the 27-product
   fingerprint `b57a51bb57be89cbc9db646d4a2a9972`, RLS on all 14 tables, `_prisma_migrations` at 12
   rows with their **original** timestamps, and `prisma migrate status` clean.
3. **Measure** the round trip, Seoul vs Mumbai, the same way I measured this morning.
4. **Switch** `DATABASE_URL`/`DIRECT_URL` in `.env`, restart, and exercise the app end to end — a real
   sale created, stock moved, receipt printed, sale deleted, stock restored, balances and reports all
   reconciled.
5. **Report both numbers** so you can see the difference rather than take my word for it.

**Seoul stays untouched throughout.** It is the rollback: if anything looks wrong, switching two lines
in `.env` puts you back instantly.

---

## After it is verified — your steps again

1. **Update the Vercel env vars** to the Mumbai strings (`DATABASE_URL`, `DIRECT_URL`).
   ⚠️ Vercel is *still* on `:6543` for Seoul today, so production has none of this morning's speed-up
   either — this fixes both at once.
2. **Set the Vercel function region to `bom1` (Mumbai)** so the serverless function sits beside the
   database instead of in Washington DC.
3. **Only then** pause or delete the Seoul project — and take one more backup first.

---

## One caveat worth stating plainly

The dump is a point in time: **08:56 today**. Anything you enter in the app between now and the
restore lands in Seoul and would be left behind. Either avoid entering real records until we switch,
or tell me and I will re-dump immediately before restoring — it takes seconds.

**File:** `docs/responses/2026-08-19-move-database-to-mumbai-PLAN.md`
