# Migration B applied — the unified sale rework is finished

**Date:** 2026-08-18
**Status:** ✅ **applied and verified.** `public` is down to 14 tables.
**Closes:** CHECKLIST #5, and with it the whole S1–S9 track.

---

## What was dropped

`BeverageSale` · `BeverageSaleItem` · `BakerySale` · `BakerySaleItem` · `MilkSale`

Seven `DROP CONSTRAINT`, then five `DROP TABLE`, no `CASCADE`. Applied with `prisma migrate deploy`
— 12 of 12 migrations now applied.

---

## Your backup, checked before anything was dropped

`E:/Carreer_efforts/backup5.sql` (297 KB). I verified it **by contents**, not by existence:

| Check | Result |
|---|---|
| Ends with `-- PostgreSQL database dump complete` | ✅ |
| `COPY` data blocks | **19** — it is not schema-only |
| `DROP` / `TRUNCATE` statements | **0** |
| A known real row (customer `Saif`, both bills) | ✅ |
| Migration F (`ProductUnit` + 60 unit rows + the new products) | ✅ |
| **All five tables about to be dropped, with their data** | ✅ |
| Row counts vs live | **identical** — Product 75, ProductUnit 60, Sale 2/2, BakerySale 1/1, MilkSale 1, Customer 1, Settings 1, User 1 |

That last row is the one that matters most: a backup that doesn't contain the tables you're about to
drop isn't a rollback for this operation at all.

Then a read-only pre-flight on the live database asked the only question that could have stopped it —
**is any old bill missing from `Sale`?** Answer: `[]`. Nothing to lose.

---

## Verified after

| Check | Result |
|---|---|
| The five tables in `information_schema` | **gone** |
| Tables remaining | **14**, RLS on every one, FORCE RLS on none |
| 27-product fingerprint | `b57a51bb57be89cbc9db646d4a2a9972` — **unchanged** |
| Your two real sales | Rs. **5,000** and Rs. **6,000**, one line each |
| Saif's balance | billed **11,000** · outstanding **11,000** |
| Reports | bakery 5,000 · milk 6,000 / 50 L · combined **11,000** — identical to before |
| Per product | Buns 100 @ 5,000 · Milk 50 L @ 6,000 |
| Catalog | 75 products · 60 selling units |
| Migration history | **12 applied** |

**And a live write, after the drop:** rang 1 dozen eggs through the till → Rs. 200, stock **100 → 88**
(the dozen's factor of 12, off one pool), then deleted the sale → stock **back to 100**. Reads,
writes, stock and deletes all work on the new shape.

---

## What this closes

The unified sale rework ran from Migration A on 2026-08-09 to here — Migrations A, C, D, E, F and B,
stages S1 through S9. The app now has **one** sale table, **one** till, **one** receipt, and **one**
place money is read from. Along the way it stopped being possible for the same bill to exist twice,
for two de-duplication filters to disagree with each other, or for a product sold on the till to look
like it had never been sold.

**What's left is go-live, not building:**

- **#2 · #2b** — the one deliberate data reset, and your real shop details in Settings
- **#3** — Vercel Pro + Supabase Pro (the free tier keeps zero backups — which is exactly why
  `backup5.sql` had to be taken by hand today)
- **#14** — move the function to Seoul, beside the database; ~1.1s per query is the whole
  performance model right now
- **#11 · #13** — PWA manifest, and a pass on a real phone

**File:** `docs/responses/2026-08-18-migration-b-applied.md`
