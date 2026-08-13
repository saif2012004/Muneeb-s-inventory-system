# Session pickup — ground truth confirmed, STOPPED before S4

**Date:** 2026-08-13
**Stage:** pre-S4 ground truth (read-only). **No code written, no migration, no write of any kind.**
**Outcome:** ✅ Everything matches expectations. **Nothing is off. Holding for the two owner
answers (Q1, Q3) before S4 recon/design begins.**

---

## 0. What I did before touching anything

Read **`CLAUDE.md` in full** (2,217 lines, including the DATABASE SAFETY section) and
**`REMAINING-WORK.md` in full** (including §0, the absolute rules), then ran only the checks listed
in the pickup instructions. Every command below is **read-only**:

| Command / query | Why it is safe |
|---|---|
| `git log -1 --stat`, `git status`, `git ls-files` | reads the repo, writes nothing |
| `npx prisma migrate status` | **read-only** — reports drift, applies nothing |
| `SELECT` statements via Supabase MCP | reads only; no DDL, no `apply_migration`, no writes |
| `grep -c` on `lib/milk.ts` | reads a file |

**`--shadow-database-url` was not used, and no destructive Prisma command was run** — no
`migrate reset`, no `db push`, no `migrate diff --from-migrations`, no `migrate deploy`. The only
Prisma CLI command executed all session was `migrate status`.

---

## 1. Repo state — ✅ as expected

| Check | Expected | Actual | |
|---|---|---|---|
| HEAD | at/after the CLAUDE.md docs commit, on top of `cbcd2eb` | **`9e8c61c`** — *"docs: update CLAUDE.md — unified-sale progress, catalog requirements, printer + roadmap pointer"* | ✅ |
| Branch | `main` | `main` | ✅ |
| Working tree | clean apart from docs | clean — only untracked `REMAINING-WORK.md` + 19 `docs/responses/*.md` | ✅ |

`cbcd2eb` (the milk product + stock bridge) is HEAD's parent, so the chain is
`8847fff` → `90e8609` → `cbcd2eb` → `9e8c61c` exactly as `REMAINING-WORK.md` describes.

---

## 2. Migrations — ✅ 9, up to date, no drift

`npx prisma migrate status` → **"9 migrations found in prisma/migrations"**, **"Database schema is
up to date!"**, connected via the **session pooler** host
(`aws-1-ap-northeast-2.pooler.supabase.com:5432`) — the correct host per `REMAINING-WORK.md` §0.8.

`_prisma_migrations` holds **9 rows, none rolled back**, and the filesystem holds the same 9
directories — git, disk and database all agree:

| # | Migration | `finished_at` (UTC) |
|---|---|---|
| 1 | `20260802201127_init` | 2026-08-02 20:11 |
| 2 | `20260803000000_enable_rls` | 2026-08-02 20:35 |
| 3 | `20260809000000_add_sale_discount_percent` | 2026-08-08 20:55 |
| 4 | `20260809120000_add_product_stock` | 2026-08-08 22:04 |
| 5 | `20260809180000_unify_sale_tables_part_a` | 2026-08-09 15:07 |
| 6 | `20260810120000_add_settings` | 2026-08-09 20:09 |
| 7 | `20260810180000_drop_product_discount_percent` | 2026-08-10 12:58 |
| 8 | `20260811120000_widen_saleitem_quantity` (Migration C) | 2026-08-11 16:55 |
| 9 | `20260812120000_widen_product_stock` (Migration D) | 2026-08-12 11:40 |

The original `finished_at` timestamps are intact — consistent with the 2026-08-12 restore having
brought the history back rather than re-applying it.

---

## 3. Real data — ✅ intact, byte-for-byte where it can be checked

Read-only row counts and sums against project `wcfdtxalwlztfsbepkrr` — **confirmed to be the same
project the repo's `.env` points at** (checked by extracting only the pooler username's project ref
from `.env`; no password was read or printed).

| Record | Expected | Actual | |
|---|---|---|---|
| Customer **Saif** | present, 1 customer total | 1 customer, name `Saif` | ✅ |
| Farmer **Saif** | present, 1 farmer total | 1 farmer, name `Saif` | ✅ |
| `BakerySale` | 1 × Rs. 5,000 | 1 row, `5000.00` | ✅ |
| `MilkSale` | 1 × Rs. 6,000 | 1 row, `6000.00` | ✅ |
| `BeverageSale` | 0 | 0 | ✅ |
| `Sale` / `SaleItem` (unified) | 1 / 1 — migration A's copy | 1 / 1 | ✅ |
| `MilkDelivery` | 250 L @ Rs. 30,000 | 1 row, `250.00` L, `30000.00` | ✅ |
| `FarmerPurchase` | Rs. 25,000 | 1 row, `25000.00` | ✅ |
| **Farmer net owed** | Rs. **5,000** | 30,000 − 25,000 = **5,000.00** | ✅ |
| `CustomerPayment` | 0 | 0 | ✅ |
| `User` (owner login) | 1 | 1 | ✅ |
| Products | 28 (27 catalog + `prod_milk`) | **28** | ✅ |
| `ZZ_TEST_` leftovers | none | 0 products, 0 customers | ✅ |

### The 27-product fingerprint matches exactly

```
b57a51bb57be89cbc9db646d4a2a9972   <- CLAUDE.md's known-good post-Migration-D value
b57a51bb57be89cbc9db646d4a2a9972   <- computed now, WHERE id <> 'prod_milk'
```

That is the stronger check — it proves the *contents* of every catalog product (id, name, price,
stock, isActive) are unchanged, not merely that the count is right. All 27 still sit at the
placeholder stock of `100.00`; none has been altered.

### `prod_milk` is exactly as the bridge left it

| Field | Value | |
|---|---|---|
| `stock` | **`0.00`** | ✅ correct — see the note below |
| `unit` | `litre` | ✅ |
| Category | **"Milk Shop"** (via `sub_milk` → `cat_milk`) | ✅ the load-bearing name for `resolveLineModule` |

---

## 4. Invariants and posture — ✅ all hold

| Invariant | Required | Actual | |
|---|---|---|---|
| `grep -c "product\|stock" lib/milk.ts` | **0** | **0** | ✅ farmer money code still cannot read stock |
| RLS enabled on every `public` table | 18 / 18 | **18 / 18** | ✅ |
| `FORCE ROW LEVEL SECURITY` | 0 tables | **0** | ✅ Prisma unaffected |
| `Settings.configuredAt` | NULL (owner has not set shop details) | **NULL** | ✅ expected — CHECKLIST #2b still open |

---

## 5. Three observations worth recording (none blocks S4)

**1. `prod_milk.stock = 0` is correct, and the historical 250 L delivery is deliberately not in it.**
The real delivery was recorded on **2026-08-11**, before the bridge and before `prod_milk` existed
(created 2026-08-13). The bridge only moves stock on delivery writes that happen *after* it shipped,
so it has never fired. This is right — retro-applying it would invent litres that were long since
sold or used. Flagging it because "milk stock is 0 while a 250 L delivery exists" looks like a bug at
a glance and is not one. The owner sets the true opening litres at handover, the same as every other
product's shelf count.

**2. CHECKLIST #16 (two untracked migrations) appears already CLOSED — CLAUDE.md still lists it open.**
`git ls-files` shows both
`20260809180000_unify_sale_tables_part_a/migration.sql` and
`20260810180000_drop_product_discount_percent/migration.sql` **are tracked**; all 10 files under
`prisma/migrations/` are committed and `git status` reports nothing untracked there. A fresh clone
would now get the full history. **I have not edited CLAUDE.md** — per the process rule, the file is
only changed as part of the change that made it stale, and I would rather flag it than quietly
rewrite a checklist item on a session I have only just picked up. Suggest closing #16 alongside the
first S4 commit.

**3. Stock placeholder is 100, while `REMAINING-WORK.md` §5 says to set 1000 before go-live.**
All 27 catalog products are at `100.00`. That is a go-live task (with CHECKLIST #2), not an S4 task,
and changing it now would move the fingerprint that just verified the data. Left alone deliberately.

---

## 6. STOPPED HERE — two owner answers gate S4

Per the pickup instructions I am not starting S4 recon/design until these are answered. Both are
about the till screen, so they change the design rather than the implementation, which is why they
are asked first.

### Q1 — Mixed receipt: per-category subtotals, or one flat list and one total?

A single bill can now carry beverages, bakery and milk lines together. The question is what the
printed receipt shows.

| Option | What the customer sees |
|---|---|
| **A — one flat list, one total** (what you said earlier) | every line in the order it was rung up, then one `TOTAL` |
| **B — per-category subtotals** | lines grouped under Beverages / Bakery / Milk, a subtotal per group, then the grand total |

**I need you to confirm A is still what you want.** Worth knowing before you decide: on a **80mm**
roll (the width we are designing for) B costs roughly 2 extra printed lines per category present, and
it means the receipt has to sort lines into groups rather than print them in entry order. Per-product
detail is a separate thing and you are getting it either way — that is the **reporting** work in S6
(#20), which is where "how much milk / how many eggs did I sell" gets answered, on screen, without
putting it on the customer's receipt.

### Q3 — Milk line entry: confirm the interaction

The design I am expecting to build, which I want confirmed before it becomes the screen:

1. **Milk sits in the product list like any other product** — no separate milk mode, no separate
   button. You tap "Milk" the same way you tap "Buns".
2. Tapping it lets you **type litres**, and fractions are fine — `2.5`, `12.5` are ordinary
   quantities (this is exactly what Migration C and D were for).
3. The **rate fills in from the catalog automatically**, and **you can overwrite it for that one
   sale** without changing the catalog price.
4. Milk lines land on the **same bill** as everything else, and selling milk **takes the litres out
   of milk stock** — which is what finally makes the milk stock figure trustworthy.

**Please confirm, or tell me what is different.** In particular: is the rate a number that changes
often enough that it should sit right there on the line every time, or should it stay tucked away
and only appear if you tap to change it?

---

## 7. What happens once you answer

**S4 recon/design first — read-only, no code — and I stop again for your review before implementing
anything.** Same gated pattern as S1/S2/S3 and the milk bridge. S4's scope, for reference:

1. **`GET /api/sales`** — the list endpoint deferred from S3.
2. **The unified sale screen** — one till, any product from any category, one bill.
3. **The milk cutover** — milk selling moves onto `/api/sales`, which makes milk stock authoritative
   and lets the provisional-state warning come out of `CLAUDE.md`.
4. **Unified DELETE/edit that restores stock** — the unified path has no DELETE at all today, and raw
   `Sale` deletion does **not** put stock back. The per-module routes already do this correctly via
   `applyStockDeltas`; the unified one will reuse it, not reimplement it.

**Nothing in S4 touches farmer money.** `lib/milk.ts` stays untouched and its
`grep -c "product\|stock"` → 0 invariant will be re-checked before every commit.

---

**Status: ground truth ✅ confirmed, nothing off, no changes made. Waiting on Q1 and Q3.**
