# Session summary — 2026-08-18

**Three stages shipped, four commits, the unified sale rework finished.**
Per-stage detail is in the four documents listed at the end; this is the one place that reads them
together.

---

## What changed today

| | Stage | Result |
|---|---|---|
| 1 | **S8 — multi-unit products** (CHECKLIST #19) | Migration F applied · 13/13 server tests · browser-verified |
| 2 | **S9 — retire the per-module sale path** (#4, #6) | 5,003 lines deleted · every figure unchanged |
| 3 | **Migration B** (#5) | 5 tables dropped · `public` down to **14 tables** |

Commits: `ae5b94b` · `d55ff56` · `60aa4d0` · `dbc53ea` · `0a9a8c0` — all on `main`.

---

## 1. Eggs sell by dozen, tray and peti. Bottles sell by pet.

Your rule, implemented literally: **stock is one pool, counted in single eggs.** A selling unit only
says how many base units leave that pool — dozen 12, tray 30, peti 360 — so 2 peti + 3 dozen is 756
eggs off one number. There is no second stock column, which is what makes it impossible for two
units to drift apart or oversell each other.

Your bottles-per-pet matrix is seeded as given, including the two things that look like mistakes and
are not: **a pet is 12 bottles here, not the 24 every reference table claims**, and **Gourmet 1.5L
carries two pets, 4 and 6**. The number lives on each product's unit row precisely because it varies
by brand and by size.

The seed added **47 beverage products at price 0** to hold the matrix. At handover you price what
you stock and deactivate the rest — the same sitting as stock counts and shop details.

Browser-verified: 2 dozen took eggs 100 → 76, editing that bill to 1 dozen put 12 back, deleting it
restored the rest. A peti against 100 in stock was refused with *"100 in stock but this sale needs
360"* — stated in eggs, because that is the number you can check against the shelf.

### 🔴 Three silent bugs this turned up

All the same shape: **a request payload built field by field, which quietly drops whatever the list
was never told about.** The request succeeds, the toast is cheerful, the value is gone.

| Where | Dropped | Consequence |
|---|---|---|
| Till create payload | `unitName` | **A peti saved as ONE egg at Rs. 7,000** — 1 off the pool instead of 360 |
| Till create payload | `chilled` | **The cooling charge was unreachable from the till** — every bill saved unchilled |
| Catalog edit dialog | `coolingCharge`, `units` | "Product updated", nothing changed |

`tsc`, lint, the build and the API tests were green through every one — the fields are optional, and
the tests hand the endpoint a correct body themselves. They were found by using the screens and
reading the rows back out of the database. Written up as **Gotcha 3c**; all three sites now carry a
comment saying every control must be listed.

---

## 2. One till, one sale table

`/beverages`, `/bakery` and `/milk/sales` are gone with their API routes, forms, hooks and the
per-module receipt. **The Shop filter on `/sales` is their replacement** — it matches a bill with at
least one line in that shop, so a bill holding Pepsi and milk appears under both, because it
genuinely is both.

Reading one table instead of four collapsed a great deal:

| | Before | Now |
|---|---|---|
| `getCustomerBalance` | 5 queries + raw SQL | **2** |
| `getCustomerActivity` | 4 + a JS de-duplication pass | **2** |
| Reports trend / top products / product sales | `UNION ALL` across 2–4 sources | one scan each |

**`notAMigrationCopy()` is deleted.** Every sum over `Sale` used to carry a `NOT EXISTS` against
three tables, because the migrations copied your bills into `Sale` keeping their ids — so each
existed twice. It also had to exist in two forms, SQL and JavaScript, and the two disagreeing is not
hypothetical: right after S5 your profile listed the same milk sale twice while the balance beside it
stayed right. That class of bug is now impossible.

**A live bug fixed on the way:** `catalog-guards.ts` checked only the old item tables, so a product
sold only on the till read as having no history — deleting it attempted a *hard* delete and the
foreign key turned it into a 500 instead of a polite "deactivate it instead."

---

## 3. The drop, and the order that made it safe

The sequence mattered more than the SQL:

1. **Code repointed and browser-verified first** — the tables had no readers left.
2. **The Prisma client regenerated without the models** — a reference became a compile error rather
   than a runtime surprise. `tsc` stayed clean, which is the proof.
3. **Your backup verified BY CONTENTS** — completion marker, 19 `COPY` blocks, no `DROP`/`TRUNCATE`,
   your real rows present, and **the five tables about to be dropped present with their data.** A
   dump missing those would not have been a rollback for this operation at all.
4. **A read-only pre-flight** asked the only question that could have stopped it — is any old bill
   missing from `Sale`? Answer `[]`.
5. **Only then** `migrate deploy`: 7 `DROP CONSTRAINT`, 5 `DROP TABLE`, no `CASCADE`.

The migration SQL was generated with the **read-only** `migrate diff --from-schema-datasource`.
Never `--shadow-database-url` — that flag drops every object in whatever you give it, and it is what
destroyed this project's production database on 2026-08-12.

### Verified after

The five tables gone · **14 tables left, RLS on every one**, FORCE RLS on none · 27-product
fingerprint `b57a51bb57be89cbc9db646d4a2a9972` unchanged · both real sales still Rs. 5,000 and
Rs. 6,000 · outstanding still 11,000 · every report figure identical · 12/12 migrations applied.

**And a live write afterwards:** 1 dozen eggs through the till → Rs. 200, stock 100 → 88, deleted →
back to 100.

---

## Where the project stands

**The unified sale rework is finished** — Migration A on 9 Aug through Migration B today, stages S1
to S9. One sale table, one till, one receipt, one place money is read from.

**What's left is go-live, not building:**

| | Item |
|---|---|
| 🔴 #2 · #2b | The one deliberate data reset, and your real shop details in Settings |
| 🔴 #3 | Vercel Pro + Supabase Pro — the free tier keeps **zero** backups, which is exactly why `backup5.sql` had to be taken by hand today |
| #14 | Move the function to Seoul, beside the database — ~1.1s per query is the whole performance model right now |
| #11 · #13 | PWA manifest, and a pass on a real phone |

One thing worth doing before handover while it is cheap: **the 47 new beverage products sit at price
0.** Price what you stock, deactivate the rest.

---

## The four documents behind this

- `docs/responses/2026-08-18-s8-multi-unit-products-shipped.md`
- `docs/responses/2026-08-18-s9-retire-old-tables-YOUR-INPUT-NEEDED.md` — the recon and your decisions
- `docs/responses/2026-08-18-s9-per-module-path-retired.md`
- `docs/responses/2026-08-18-migration-b-applied.md`

**File:** `docs/responses/2026-08-18-session-summary.md`
