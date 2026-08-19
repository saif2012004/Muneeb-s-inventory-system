# REMAINING WORK — the handover document

**Last updated:** 2026-08-19
**Status:** **the build is finished.** Every development phase (1–8) and every stage of the
unified-sale rework (S1–S9) has shipped, been verified, and is live in production.

**This file used to be a build roadmap. It is now a handover document**, because there is no
development work left — only the sitting where the owner's real data replaces ours and the billing
plan changes. `CLAUDE.md` remains the source of truth for how the codebase works and for the safety
rules; this file is what is left to *do*.

> ⚠️ **"Build complete" is NOT "ready to hand over."** Two of the items below block go-live
> outright, and one of them is a terms-of-service problem, not a nice-to-have.

---

## 1. WHAT IS LEFT — all of it, honestly

### 🔴 1a. The data reset — **BLOCKS GO-LIVE** (CHECKLIST #2)

The database still holds the working set this app was built against, mixed in with the owner's
genuine records. He must start on a database holding only his own.

**Counted 2026-08-19, in the Mumbai database `.env` points at:**

| Table | rows |
|---|---|
| `Sale` | 10 |
| `SaleItem` | 14 |
| `Customer` | 3 |
| `CustomerPayment` | 0 |
| `Farmer` | 2 |
| `MilkDelivery` | 3 |
| `FarmerPurchase` | 4 |
| `Product` | 75 (73 still at Rs. 0) |

⚠️ **Re-count these the day you do it.** The app is live and in use, so these are a snapshot, not a
specification. The version of this table that lived here before listed three tables Migration B had
already dropped — a delete set sized from it would have targeted a database that no longer existed.

**The difficulty is that the rows are MIXED.** Some are the owner's real records — the farmer ledger
especially, which is genuine money owed — and some are ours from building and testing. **Nobody but
the owner can tell you which is which.** Go through it with him row by row.

**Do it ONCE, deliberately, with the delete set confirmed first.** Piecemeal cleanup is how a row
that turned out to matter gets lost.

**What to decide explicitly:** the owner account, the catalog, and real customers/farmers almost
certainly survive; everything transactional almost certainly does not. *Almost* is doing real work
in that sentence — confirm it, do not assume it.

### 🔴 1b. Vercel Pro + Supabase Pro — **BLOCKS GO-LIVE** (CHECKLIST #3)

Event-triggered: **the moment the owner starts entering real records and relying on the app.**

- **Vercel Hobby FORBIDS commercial use.** Once this is a live business tool, staying on Hobby is a
  terms violation — and enforcement would land on the system the owner runs his books on.
- **The Supabase free tier keeps ZERO automatic backups and offers no point-in-time recovery.** This
  project has already lost its entire database once (2026-08-12) and was saved only by a manual
  dump. Do not hand a business's money records to a zero-backup tier.

Minimum acceptable alternative if Pro is genuinely refused: a scheduled keep-alive ping **plus** a
weekly verified `pg_dump`. Pro is the better answer.

### 🟡 1c. The owner's prices and shelf counts — his task, at handover

- **73 of 75 products are at Rs. 0.** The S8 seed created the multi-unit matrix (47 new beverage
  products) at zero deliberately, for him to price. **He prices what he stocks and deactivates the
  rest.**
- **Stock is a placeholder on every product.** The reset is the moment he walks the shelf and enters
  real counts. **Milk is the exception** — its stock is derived (deliveries add, sales subtract) —
  but its opening figure was never a count of the fridge, so he sets that too.
- **Cooling charges are unset.** No product carries one, so no chill toggle appears anywhere yet.

### 🟡 1d. On-device check on a real phone (CHECKLIST #13)

The last untested surface. **A desktop viewport resized to 360px is geometry, not a device** — it
does not reproduce the on-screen keyboard, touch accuracy, real network latency, or paint
performance. **Milk quick entry especially**: it is the densest screen and he uses it twice a day.

### ⚪ 1e. Supabase Data API surface (CHECKLIST #15) — a decision, not a defect

`anon` / `authenticated` keep table-level GRANTs, but RLS (on, zero policies, default deny) makes
them useless for reading rows. **This is not a leak.** Restricting the exposed schemas is the
owner's call and would not affect Prisma, which never goes through PostgREST.

---

## 2. THE SAFETY RULES — still absolute

Most are expanded in the DATABASE SAFETY section of `CLAUDE.md`. **This project has already suffered
one full production-database wipe.**

1. **NEVER pass a real connection string to `--shadow-database-url`.** Prisma's shadow database is a
   scratch DB it **DROPS EVERY OBJECT IN** before replaying migrations. Passing `DATABASE_URL` or
   `DIRECT_URL` — or anything from `.env` — **destroys production**. This is exactly what happened
   on 2026-08-12. Use `prisma migrate diff --from-schema-datasource` (read-only). *If you cannot
   point to a database you would happily drop right now, you do not have a shadow database.*

2. **A `P3006` "failed to apply cleanly to the shadow database" against a real URL is a DAMAGE
   REPORT, not a failed command.** By the time it prints, Prisma has already dropped everything.
   STOP. Do not retry, do not route around it. Verify database state immediately.

3. **NEVER run `prisma migrate reset` or `prisma db push` against live.** Both are destructive. Only
   `migrate status` (read) and `migrate deploy` are safe.

4. **Every migration is gated.** Verified backup first — verified **by CONTENTS**: grep the dump for
   a known real row, confirm it ends with `-- PostgreSQL database dump complete`, and confirm it has
   `COPY` / data blocks. **A schema-only dump is not a backup.** Then show the SQL and STOP for
   human approval. There is no dry-run target.

5. **One money-touching change at a time.** Verify to the paise. **Never reimplement the money
   helpers in `lib/sales.ts`** — reuse them verbatim. Reimplemented arithmetic is how rounding
   errors reach a customer's bill.

6. **`ZZ_TEST_` prefix all test data, and clean it up.** Never modify the owner's real records.

7. **The farmer balance is hard-protected.** Farmer money math (`lib/milk.ts`) must never be touched
   by sale or stock work. The invariant must always hold — farmer money code cannot read the column
   the stock bridge writes:

   ```bash
   grep -c "product\|stock" lib/milk.ts     # must be 0
   ```

8. **Credentials:** never paste a live connection string anywhere it can leak. If the password is
   rotated, update **both** local `.env` and Vercel (Preview **and** Production — note that
   `vercel env rm NAME production` silently removes it from every environment).
   **🔴 PERCENT-ENCODE the password** — a `$` is expanded by dotenv and breaks the app while every
   diagnostic script still works, which is what makes it so misleading. Connect via the **session
   pooler** host on **:5432**; never `db.<ref>.supabase.co` (does not resolve from this network) and
   never `:6543` (the transaction pooler adds ~950 ms per query).

9. **Gate every risky stage:** recon and design, human review, implement, test, commit. **When in
   doubt, STOP and report rather than guess.**

---

## 3. WHERE THINGS STAND — the facts a fresh session needs

| | |
|---|---|
| Production | `https://muneeb-inventory-system.vercel.app` |
| Vercel project | `muneeb-inventory-system` (scope `saifurrehmanch104-5326s-projects`, **Hobby**) |
| Function region | `bom1` (Mumbai) — set in `vercel.json` |
| Database | Supabase, **`ap-south-1` (Mumbai)**, session pooler `:5432`, `connection_limit=5` |
| Round trip | **~96 ms** (was 226 ms in Seoul; was ~1,175 ms on the transaction pooler) |
| Owner login | `i228767@nu.edu.pk` — reset with `npm run create-owner -- <email> "<password>"` |
| Tables in `public` | **14**, RLS on every one, zero policies (default deny), FORCE RLS on none |
| Shop details | **Set** — "Mateen Traders", `configuredAt` non-NULL since 2026-08-19 |

### Verify ground truth before doing anything

```bash
git log -1
npx prisma migrate status              # expect "up to date"
grep -c "product\|stock" lib/milk.ts   # must be 0
```

Then a **read-only** row count. Do not trust any number written in a document, including this one.

---

## 4. STILL PENDING A DECISION, NOT A BUILD

**Receipt paper width.** `RECEIPT_LINE_CHARS` is **32** (58mm). The owner is buying a new printer and
**80mm is recommended** — once confirmed, set the constant to **48** and the `shopName` cap follows
automatically, because it is derived rather than hardcoded.

**Confirm the actual roll first.** A 58mm layout prints fine on 80mm, leaving margin; an 80mm layout
wraps every line of a 58mm roll into nonsense. The risk is asymmetric, which is why it defaults
narrow.

---

## 5. THE BUILD DIARY IS IN GIT, NOT IN THE REPO

The `docs/` folder — 112 phase reports and dated response files — **was removed on 2026-08-19**,
deliberately, now that the build it documented is finished.

**Every file is still in git history.** They were committed immediately before deletion, precisely so
that nothing became unrecoverable:

```bash
git log --oneline -- docs/          # the history
git show <commit>:docs/responses/<file>.md
```

Nothing in `CLAUDE.md` or in the source depends on them any more. The ~20 "evidence: docs/…"
pointers were **stripped rather than left dangling** — every claim they supported now stands on its
own. A pointer to a file that no longer exists is exactly the confident, specific, wrong instruction
that the process rule at the top of `CLAUDE.md` exists to prevent.
