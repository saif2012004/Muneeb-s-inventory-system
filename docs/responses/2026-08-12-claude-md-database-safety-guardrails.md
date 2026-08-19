# CLAUDE.md guardrail update — DB-wipe lessons, restore procedure, backup discipline

**Date:** 2026-08-12
**Starting HEAD:** `9b87dc4` (tree clean — untracked response docs only)
**Commit:** **`6f18b52`** — `CLAUDE.md | 186 ++++++`, 1 file changed, 186 insertions, 0 deletions
**Database access this turn:** **none.** No migration, no code, no schema, no `.env`.

---

## Pre-flight

```
HEAD                : 9b87dc4  refactor: split milk-sale code out of lib/milk.ts
tracked mods        : 0
untracked           : 12 files, all docs/responses/*.md
```

✅ Clean, proceeded.

---

## One correction to the brief

> *"if CLAUDE.md still carries the pre-existing note that Migration D can be code-neutral,
> correct it"*

**There was no such note to correct.** CLAUDE.md had never mentioned Migration D at all — grep for
`Migration D`, `code-neutral`, `SaleProduct`, `failStockBlocked` returned nothing relevant (the one
`shadow` hit was `shadow-sm` in the Design System). Migration D lived only in `docs/prompt.txt` and
my incident report.

So rather than fixing a wrong claim, I **added** the scoping note, which satisfies the actual intent
— *"just make sure the doc reflects this so the next session scopes it correctly."*

---

## What was added

### Placement

**Section 1 — `## ⚠️ DATABASE SAFETY — hard-won guardrails`** sits **immediately before
`## Database security (READ BEFORE TOUCHING RLS)`**, so the two database sections are adjacent and
*safety comes first*. A session scrolling to the RLS rules cannot miss it.

**Section 2 — the Migration D note** went into **PRE-HANDOFF CHECKLIST #4** (the unified `Sale`
build), *not* into the safety section. That respects the file's one-place rule: #4 is where the
unified-sale scope is tracked, and Migration D is part of that scope. Putting it in a prose section
is exactly the failure mode the checklist exists to prevent.

---

## The text added — §1, DATABASE SAFETY

Four sub-sections, matching the four points in the brief.

**1. `🔴 NEVER pass a real connection string to --shadow-database-url`** — quotes the exact command
that wiped production, then explains the *mechanism* rather than just banning the string: Prisma's
shadow database is a disposable scratch DB that it **drops every object in** before replaying
migrations, so whatever you hand the flag is what gets emptied. States the rule absolutely:

> `--shadow-database-url` takes a throwaway database and nothing else. Never `DATABASE_URL`, never
> `DIRECT_URL`, never anything read out of `.env`. **If you cannot point to a database you would
> happily drop right now, you do not have a shadow database and must not use the flag.**

Includes the safe alternatives as a table — `migrate diff --from-schema-datasource` (read-only
introspection) and diffing migration files with no shadow at all — plus the note that the read-only
form produced usable SQL thirty seconds later, so **the shadow database was never needed**. Closes
by flagging `migrate reset` and `db push` as also destructive, against `migrate status` as safe.

**2. `🔴 A P3006 against a real URL is a DAMAGE REPORT, not a failed command`** — quotes the actual
error, then states plainly that by the time it prints, Prisma has *already* dropped everything and
is reporting **how far the replay got**. Instruction on sight of it: stop immediately, do not retry,
do not try a different SQL-generation route, verify state and report first. Adds the general habit
that would have caught it in seconds — *when a diff says tables you know exist are missing, treat it
as evidence the database changed, not a tooling quirk.*

**3. `✅ The restore procedure that worked`** — full `pg_dump` as the source; the **session pooler**
host `aws-1-…pooler.supabase.com:5432` with an explicit ❌ against `db.<ref>.supabase.co` (does not
resolve from this network) and a note that 6543 is transaction mode and cannot run a restore;
`DROP SCHEMA public CASCADE` + `CREATE SCHEMA public`; `psql "<url>" -f backup.sql`. Then the point
most likely to cause a wrong abort:

> **⚠️ The error flood during load is EXPECTED AND HARMLESS. Do not abort.** `must be owner of …`,
> `permission denied for schema auth/storage/realtime` are Supabase-internal objects the `postgres`
> role cannot recreate. **The signal to watch is the `COPY n` row counts for the `public` schema.**

Plus the five read-only verification steps, including the product fingerprint SQL with its
known-good value `95794a0bb44f1b15d541a60ef0bd5c51`, the warning **not** to "fix" restored migration
history with `migrate deploy`, and that only an actual sign-in proves login works.

**4. `🔴 BACKUP DISCIPLINE — verify by CONTENTS, never by existence`** — a backup is verified by
grepping the dump for a known real row (`Saif`) and confirming it ends with
`-- PostgreSQL database dump complete`; **a schema-only dump with no `COPY`/`INSERT` blocks is not a
backup**; and free tier has **zero automatic backups and no PITR**, so the manual dump is the only
copy. Ends on the habit that paid for itself — without that verified backup, all 27 products, both
real sales, the farmer ledger, the settings row and the owner's login would have been permanently
gone.

---

## The text added — §2, Migration D scoping (CHECKLIST #4)

Titled **`⚠️ Migration D (widen Product.stock to Decimal) is NOT code-neutral — scope it
accordingly`**, and it leads with the consequence: *anyone scoping it as "one `ALTER TABLE`, no
code" will get a red build.*

Records that the widening itself is **lossless** (all 27 rows whole; `Product.price` in the same
table is already `numeric(10,2)`), and that the problem is entirely code-side:

- **4 `tsc` errors**, all at the `loadSaleProducts({ findMany })` callback, because
  **`SaleProduct.stock` in `lib/sales.ts` is a hand-written `number`**, not Prisma-derived.
- **That firewall is also the trap** — downstream still believes `stock` is a number:
  - the arithmetic **survives by accident** (`Decimal - number` coerces via `valueOf()`);
  - the JSON **does not** — `failStockBlocked` returns `shortBy` **without `serialize()`**, so
    `available` ships as the string `"100"`, and `InlineStockEditor`'s `next === stock` guard then
    compares a number to a string and never matches.
- **Also blocking:** the `quantity` validator is `.int()` and rejects `12.5`.
- **Minimal fix:** normalise `stock` to a number inside `loadSaleProducts` — one place, all four
  route files untouched; `/api/products` is already safe via `serialize()`.

Both consequences are marked as **confirmed by executing the code**, per the file's own rule about
saying which source a claim came from.

---

## Nothing else changed

```
$ git status --porcelain | grep -v '^?? docs/'
 M CLAUDE.md

$ git diff --name-only | grep -vc '^CLAUDE.md$'
0
```

| Constraint | Status |
|---|---|
| CLAUDE.md the only file changed | ✅ 1 file, 186 insertions, **0 deletions** |
| No code, schema, or migration | ✅ diffstat confirms |
| No database access of any kind | ✅ no query, no Prisma command, no MCP call this turn |
| No `migrate diff` / `deploy` / `reset` / `db push` | ✅ none run |
| Nothing connected to `--shadow-database-url` | ✅ |
| `.env` / credentials untouched | ✅ |

**0 deletions is worth noting** — this is purely additive. No existing guidance was reworded or
removed, so nothing that was already true became stale.

---

## Commit

```
6f18b52  docs: record DB-wipe guardrails, restore procedure, and backup discipline in CLAUDE.md
         CLAUDE.md | 186 ++++++++++++++++++++++++++++++++++++++++++++++++++
         1 file changed, 186 insertions(+)
```

Not pushed — no instruction to. Say the word if you want it on `main` remote.

---

## State

| | |
|---|---|
| `HEAD` | **`6f18b52`** (was `9b87dc4`) |
| Tree | clean apart from untracked `docs/responses/*.md` |
| Database | restored and verified; **untouched this turn** |
| Migration D | still not started — now correctly scoped in CHECKLIST #4 |
