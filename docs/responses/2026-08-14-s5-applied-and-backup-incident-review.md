# Your two psql commands reviewed — no damage — and S5 applied

**Date:** 2026-08-14 · **Verdict on both commands: nothing was harmed.**
**S5 applied and verified** on your authorisation to choose. **5/5 app checks + 6 database checks.**

---

## 1. The command you ran against the live database

```
psql "postgresql://…pooler.supabase.com:5432/postgres" -f "E:\Carreer_efforts\backup2.sql"
```

**That is not a way to check a backup — it is a RESTORE.** `-f` executes every statement in the file
against whatever database you point it at. You pointed it at production. It happens to have been
harmless, for one reason:

| Check on `backup2.sql` | Result |
|---|---|
| `DROP` statements | **0** |
| `DROP SCHEMA` | **0** |
| Real `TRUNCATE` statements | **0** — the 18 hits are inside `GRANT INSERT,…,TRUNCATE,… ON TABLE` privilege lists |
| `CREATE TABLE` | 52 → all failed "already exists" |
| `COPY` data blocks | 18 → all failed on duplicate primary keys |

So it produced a wall of errors and wrote nothing. **Had that dump been taken with `--clean` (which
emits `DROP TABLE`/`DROP SCHEMA`), the same command would have wiped the database and rolled you back
to 12 August** — losing Migration D, `prod_milk`, and everything built since.

**Verified live afterwards, not assumed:**

| | Expected | Actual |
|---|---|---|
| 27-product fingerprint | `b57a51bb…` | **identical** ✅ |
| `prod_milk` | exists, stock 0.00 | **exists, 0.00** ✅ (a real restore would have deleted it) |
| `Product.stock` type | `numeric` (Migration D) | **numeric** ✅ |
| Last migration applied | 2026-08-12 11:40 (D) | **unchanged** ✅ |
| Duplicate product ids / names | 0 / 0 | **0 / 0** ✅ |
| Saif · bakery · milk · delivery · purchase | present · 5,000 · 6,000 · 250 L / 30,000 · 25,000 | **all exact** ✅ |
| RLS | 18/18 | **18/18** ✅ |

### To actually CHECK a backup, never point psql at production

```bash
# Verify by CONTENTS — the rule in CLAUDE.md. All read-only, no database involved:
grep -c "Saif" backup2.sql                              # a known real row is in there
grep -c "^COPY public" backup2.sql                      # 18 data blocks, not schema-only
grep -c "PostgreSQL database dump complete" backup2.sql # it wasn't truncated mid-write
```

If you ever want to *restore-test* one, restore it into a **throwaway** database — never the live URL.

## 2. The malformed SELECT — completely harmless

PowerShell ate the quoting, so psql received fragments and rejected the statement with
`unterminated quoted identifier` **before executing anything**. It was also a `SELECT`: read-only by
nature. **No issue whatsoever, and running it twice changes that not at all.**

For next time, a here-string avoids the quoting fight entirely:

```powershell
psql "$env:DIRECT_URL" -c @'
SELECT (SELECT count(*) FROM "Product") AS products,
       (SELECT count(*) FROM "Customer") AS customers;
'@
```

## 3. 🔴 One thing to fix: the password

The connection string in `docs/prompt.txt` includes a password. **The file is gitignored and is NOT
tracked**, so nothing leaked into git — I checked. But it now sits in plaintext on disk and has been
pasted into a chat.

**If that is your real database password, rotate it** (Supabase → Settings → Database → Reset), then
update `.env` (`DATABASE_URL` **and** `DIRECT_URL`, keeping `?pgbouncer=true&connection_limit=1` on
the pooled one) and Vercel's Preview + Production. If you typed `password` as a placeholder, ignore
this.

---

## 4. S5 applied

You said to choose the best option, so I applied it — the safest write in this project: two inserts
of two new rows, nothing updated, nothing deleted, reversible by two deletes.

**What went in** — the milk sale, copied the way migration A copied the bakery one:

```
Sale      cmsjh84mt0009uve8xh13m74k  6000.00  createdAt 2026-08-07 21:48:25.589 (preserved)
SaleItem  same id → prod_milk · moduleKey "milk" · 50.00 × 120.00 · line 6000.00 · net 6000.00
```

Every value was read **from the row itself**, never retyped, so `50 × 120` was never arithmetic I did
by hand on your money. SQL confirms `quantity × unitPrice = 6000.0000` against a stored
`lineTotal` of `6000.00`.

**Stock was deliberately not touched.** That sale predates the stock bridge; decrementing would drive
`prod_milk` to **−50** and describe a fridge that never existed. It is still 0.00.

### Verification — 6 database checks + 5 app checks, all passed

```
Sale 2 / SaleItem 2 · MilkSale still 1 · BakerySale still 1
createdAt + saleDate preserved · qty × price = 6000.0000 = lineTotal
Unified rows counted toward totals: 0   <- both are copies, correctly excluded
fingerprint b57a51bb… identical · prod_milk 0.00 · delivery 30,000 · purchase 25,000

PASS  Saif's balance unmoved (the copy is deduped)        billed=11000
PASS  Customer LIST agrees with the profile               11000
PASS  Reports unmoved: 5,000 / 6,000 / 11,000
PASS  Sales by product: milk still ONE row of 50 L / 6,000
PASS  Unified list shows both migrated bills              modules ["milk"] ["bakery"]
```

**No figure moved anywhere, and that is the success condition** — S5 is staging, not switching. Both
copies stay excluded by `notAMigrationCopy()` until S9 drops the old tables, at which point the
copies simply become the live records.

**Rollback if ever wanted:**

```sql
DELETE FROM "SaleItem" WHERE id = 'cmsjh84mt0009uve8xh13m74k';
DELETE FROM "Sale"     WHERE id = 'cmsjh84mt0009uve8xh13m74k';
```

---

## 5. Where that leaves the project

**Done:** the unified till, its receipt, receivables, the milk cutover with authoritative stock,
reports repointed, per-product visibility, and now S5.

**Remaining:**

1. **CHECKLIST #8** — the unified edit/PATCH screen (delete + re-ring works meanwhile).
2. **S7** — cooling charge per beverage size, billing-time price override field.
3. **S8** — multi-unit products (eggs dozen/tray/peti, beverages bottle/pet, one stock pool).
4. **S9** — remove the old per-module paths, then Migration B drops the four old tables.
   ⚠️ **That one genuinely needs a fresh verified backup** — it is the first stage that destroys
   anything, and today's newest dump predates Migration D.
5. **Go-live** — real shop details, real opening stock counts (including milk's opening litres),
   Vercel Pro + Supabase backups, region co-location.
