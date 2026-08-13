# REMAINING WORK — Unified Sale Project Handoff

**Purpose:** This file lets a fresh Claude Code session pick up the unified-sale rework with
full context. Read this AND `CLAUDE.md` before doing anything. `CLAUDE.md` is the source of
truth for how the codebase works and the safety rules; this file is the roadmap of what is
done and what remains.

**Last updated:** 2026-08-14
**Current HEAD when this was written:** `462d06a` (S4 complete: S4.1 + S4.2 + S4.3)

---

## 0. READ THIS FIRST — how to work on this project safely

This project has already suffered **one full production-database wipe** and several
credential incidents. The rules below are not optional. Most are expanded in `CLAUDE.md`'s
DATABASE SAFETY section — read that too.

### The absolute rules (violating any of these has caused or nearly caused disaster)

1. **NEVER pass a real/production connection string to `--shadow-database-url`.** Prisma's
   shadow database is a scratch DB it **DROPS EVERY OBJECT IN** before replaying migrations.
   Passing `DATABASE_URL` or `DIRECT_URL` (or anything from `.env`) to that flag **destroys
   production**. This is exactly what wiped the database on 2026-08-12. To generate migration
   SQL, use `prisma migrate diff --from-schema-datasource` (read-only introspection) or
   hand-write and verify the SQL. If you cannot point to a database you would happily drop
   right now, you do not have a shadow database and must not use the flag.

2. **A `P3006` "failed to apply cleanly to the shadow database" against a real URL is a DAMAGE
   REPORT, not a failed command.** By the time it prints, Prisma has already dropped everything
   and is reporting how far the replay got. If you see it: STOP, do not retry, do not route
   around it, verify database state immediately.

3. **NEVER run `prisma migrate reset` or `prisma db push` against the live database.** Both are
   destructive. Only `migrate status` (read) and `migrate deploy` (applies committed migrations)
   are safe on live.

4. **Every migration is gated.** Before any migration: confirm a verified backup exists
   (verified by CONTENTS — grep the dump for a known real row like `Saif` and confirm it ends
   with "dump complete"; a schema-only dump with no COPY/data blocks is NOT a backup). Write the
   migration, verify it is lossless against the actual rows, show the SQL and the plan, and STOP
   for the human to approve applying to live. There is no dry-run target (Supabase free tier, no
   branching), so the live apply is a deliberate human-approved step every time.

5. **One money-touching change at a time.** Verify money math to the paise. Never reimplement
   the money helpers in `lib/sales.ts` — reuse them verbatim. Reimplemented arithmetic is how
   rounding errors reach a customer's bill.

6. **`ZZ_TEST_` prefix for ALL test data**, and clean it up. NEVER modify the real data: the
   customer/farmer **Saif**, the 2 real sales (bakery Rs.5,000, milk Rs.6,000), the farmer
   delivery (250 L @ 30,000), the farmer purchase (25,000), farmer net owed (Rs.5,000). These
   are the owner's real records.

7. **The farmer two-way balance is hard-protected.** It is the only real "owing" in the system.
   Farmer money math (`lib/milk.ts`) must never be touched by sale/stock work. The invariant
   `grep -c "product\|stock" lib/milk.ts` → **0** must always hold — farmer money code cannot
   read stock. Keep it that way.

8. **Credentials:** never paste a live connection string anywhere it can leak. If a password is
   rotated, update BOTH local `.env` (DATABASE_URL and DIRECT_URL, keep `?pgbouncer=true&
   connection_limit=1` on the pooled one) AND Vercel (Preview + Production). Connect via the
   SESSION pooler host (`aws-1-...pooler.supabase.com:5432`), NOT the direct
   `db.<ref>.supabase.co` host (which does not resolve from the owner's network).

9. **Gate every stage: recon/design first for anything risky, then implement after human review,
   then test, then commit.** Do not barrel from design straight into a money-write or
   farmer-adjacent change. When in doubt, STOP and report rather than guess.

---

## 1. WHAT THE APP IS

A business-management app for a single owner running three shops out of one storefront:
a **Pepsi/beverage agency**, a **bakery**, and a **milk shop**. Plus a **farmer** side (the
owner buys milk from farmers and sells them feed — a two-way running balance).

Built on Next.js (App Router) + Prisma + Supabase (Postgres). Single owner login. Currently
a Phase-1 build; not yet live for daily use.

---

## 2. WHAT IS DONE (do not redo)

The **unified cross-category sale** rework replaces three separate per-module sale screens
(beverages, bakery, milk) with ONE checkout that can ring up any product from any category on
a single bill. Progress so far:

- **Migration C** (`20260811120000`): `SaleItem.quantity` widened Int → Decimal(10,2) so milk
  can sell in fractional litres. Applied, reconciled.
- **Migration D** (`20260812120000`): `Product.stock` widened Int → Decimal(10,2) so stock can
  decrement fractionally (12.5 L). Applied, reconciled. Came with a code fix: `loadSaleProducts`
  normalises stock to a number at the boundary (`toSaleProduct`), and `failStockBlocked` runs
  its payload through `serialize()` so stock never ships as a string.
- **S2**: split `lib/milk.ts` → `lib/milk-sales.ts` so milk-SALE code is separated from FARMER
  code. Farmer code untouched; the two files cannot import each other.
- **S3** (`app/api/sales/route.ts`): the unified **`POST /api/sales`** endpoint. Writes one
  `Sale` + its `SaleItem`s across categories in one transaction. Reuses `lib/sales.ts` money
  helpers verbatim. No discounts (netLineTotal == lineTotal). All-or-nothing stock check.
  Transaction raised to 15s with the response read-back moved outside it. `moduleKey` resolved
  per line from the product's category. Built ALONGSIDE the old per-module routes — nothing
  removed. Tested 21/21. **Milk was designed-for but dormant at this point.**
- **Milk product + delivery-to-stock bridge** (`cbcd2eb`): created the milk product
  (`prod_milk`, category `cat_milk` "Milk Shop", sub `sub_milk`, unit "litre", **stock starts
  at 0**). Built `lib/milk-stock.ts` (the bridge, kept OUT of `lib/milk.ts`). When a farmer
  delivery is recorded/edited/deleted (all 4 paths: create, PATCH, DELETE, quick-entry), milk
  stock reconciles **by delta** (+litres on create, +(new−prior) on edit, −litres on delete).
  Never-negative refusal with a delivery-specific 409 that names the fix. Tested 22/22, farmer
  money byte-identical.

**Data/logic layer for the unified sale is now COMPLETE across all three categories.** Milk
resolves to `moduleKey "milk"` in `/api/sales` with no change to that endpoint. Everything from
here is the screen on top, plus the product-catalog features, plus go-live.

### ✅ CLOSED 2026-08-14 — milk stock is now authoritative

~~Milk stock is tracked but NOT authoritative.~~ **S4.3 cut milk selling over to the unified till.**
Deliveries add, till sales subtract, a deleted bill restores — and `/milk/sales` can no longer create
a sale, so nothing moves milk without moving stock. `POST /api/milk/sales` still exists but is
unreachable from the UI; **do not wire a new screen to it and do not add a stock decrement there** —
it retires with the other per-module paths at S9.

**The one caveat is the opening number**: `prod_milk.stock` started at 0 and the real 250 L delivery
predates the bridge, so it was never added. Everything since the bridge is correct; the owner sets
the true opening litres at handover, like every other shelf count.

### 🔴 KNOWN PROVISIONAL STATE (important)

**REPORTS still read the OLD tables.** `lib/reports.ts` (revenue, counts, trend, top products) and
the CSV export have not been repointed, so a sale rung up on the unified till appears in the
customer's balance and on its receipt but in **no report figure**. Closed by S6. Receivables was
bridged in S4.2 and is correct.

---

## 3. REMAINING WORK — in order

Each item is its own gated stage: recon/design → human review → implement → test → commit.
Do NOT combine stages. Do NOT skip the gates.

### ✅ S4 — DONE 2026-08-14 (S4.1 `26675b2` · S4.2 `462d06a` · S4.3)

The owner-facing till shipped: `/sales` + `/sales/new`, `GET`/`DELETE /api/sales[/id]` (delete
restores stock), the unified receipt at `/receipt/sale/[id]` (flat list, one total — the owner's Q1
answer), the receivables bridge with the migration-A dedupe, and the milk cutover.

**Owner answers received 2026-08-14:** Q1 → one flat list, one total. Q3 → milk sits in the product
list, litres typed, catalog rate pre-filled and overridable. Both are implemented as answered.

**STILL OPEN from this stage:** the unified **EDIT/PATCH** and its screen — CHECKLIST #8. A wrong
bill is deleted (stock restored) and re-rung meanwhile.

<details>
<summary>Original scope (kept for the record)</summary>

**Includes:**
- **`GET /api/sales`** (list endpoint) — deferred from S3; the screen needs it to list sales.
- The unified sale screen UI: pick products from any category, set quantity (litres for milk),
  optional per-line price override (see S7 below — the "updated charge at billing" field), one
  flat receipt, one total, spot payment, no discounts.
- **Route milk selling through `/api/sales`** — this is the cutover that makes milk stock
  AUTHORITATIVE and closes the provisional-state warning in `CLAUDE.md`. After this, remove
  that warning from `CLAUDE.md`.
- **Unified sale DELETE/edit that RESTORES stock** — the unified endpoint currently has no
  DELETE route. The per-module routes restore stock on delete; the unified one must too,
  reconciling stock the same way (via `applyStockDeltas`). This closes a gap found during the
  milk-bridge testing (raw `Sale` deletion does not restore stock today).

**OWNER ANSWERS STILL NEEDED before S4 design (ask the owner):**
- **Q1 — Receipt subtotals:** Does the mixed receipt need per-category subtotals, or one flat
  list with one total? (Earlier the owner said one flat list, one total, no subtotals — CONFIRM
  this is still what they want for the printed receipt.)
- **Q3 — Milk line entry:** Confirm the interaction — milk sits in the product list like any
  product; tapping it lets the owner type litres (e.g. 2.5, 12.5) and the rate fills from the
  catalog but is overridable for that sale. (This is expected to be a yes; confirm.)

</details>

### S5 — Move the real sales into the unified table (data migration, GATED)

The 2 real sales currently live in the old per-module tables (`BakerySale`, `MilkSale`). Once
the unified screen is proven, migrate the real sales into the unified `Sale`/`SaleItem` tables
so reporting can read from one place. **This touches real money data — maximum care, verified
backup first, human-approved apply, reconcile to the paise.**

### S6 — Reporting repoint + PER-PRODUCT sales visibility

Point the reports/dashboard at the unified `Sale`/`SaleItem` tables. **The owner wants
PER-PRODUCT sales visibility** — not just per-category totals, but how much of each product
sold (how much milk, how many eggs, biscuits, buns, each beverage). The data supports this
(`SaleItem.productId` on every line); the reports must surface it. Milk must show as its own
line (its `moduleKey` is "milk", separable from bakery).

### S7 — Product catalog: cooling charges + billing-time price override

Two owner-requested catalog features. These are their own stage (touch the product model and
the billing screen).

- **Cooling/chilling charge field per product:** every BEVERAGE product (each size separately)
  gets a **"cooling charge" field in its catalog listing** that the owner sets himself. At
  billing, when a beverage is added, show a **toggle + rate field** — toggle ON applies the
  cooling charge (rate defaults from the catalog, overridable for that sale), toggle OFF does
  not charge it. Put placeholder cooling charges in for now (the owner updates real ones before
  handover). The owner floated rough numbers to confirm, not treat as final: ~+10 on 0.5L,
  ~+20 on 1L, ~+30 on 1.5L, ~+50 on 2L/2.25L — CONFIRM with the owner.
- **Billing-time "updated charge" override for EVERY product:** on the bill, EVERY product
  (whole inventory, not just beverages) gets an **optional field where the owner can type an
  updated price** if the catalog price is not up to date yet. This is the create-time
  `unitPrice` override the unified endpoint already supports on the API side — S7 surfaces it
  in the UI for every line. (The API already honours it; this is the screen field.)

### S8 — Multi-unit products (eggs + beverages sharing one stock pool)

A product sold in several units that all draw from ONE stock pool. Its own feature stream.

- **Eggs:** sold as **dozen**, **tray (30 eggs)**, and **peti (carton = 12 trays = 360 eggs)**,
  all sharing one egg-stock pool (sell a peti, the loose-egg count drops by 360). Prices
  confirmed: **dozen Rs.200, tray Rs.500, peti Rs.7000.**
- **Beverages:** each brand+size sold both as a **single bottle** AND as a **pet** (a
  multi-bottle pack), sharing one stock pool. Need per-size: single-bottle price, pet price,
  and **how many bottles per pet for that size**. The owner's earlier inputs are final EXCEPT:
  **the local quarter has 12 bottles per pet, not 24.** (Correct this.) Real prices are
  placeholders until handover.

### S9 — Remove the old per-module sale paths (GATED, last)

Once the unified screen has soaked and everything reads from the unified tables, remove the old
per-module sale screens and routes (`/beverages/new-sale`, `/bakery/new-sale`, `/milk/sales`,
their API routes). This is the LAST step and only after a soak period. Then optionally drop the
old tables (`BeverageSale`, `BakerySale`, `MilkSale`) in a final gated migration.

---

## 4. BEVERAGE CATALOG DATA (owner to provide; placeholders until handover)

The beverage list is large — many brands, each in several sizes, each sold single + pet. For
every beverage size we need, from the owner: single-bottle price, pet price, bottles-per-pet,
and cooling charge. **All prices/charges are placeholders until just before handover** — the
owner fills real numbers then. The KNOWN correction: **local quarter = 12 bottles per pet (not
24).** Everything else the owner gave earlier stands.

---

## 5. GO-LIVE CHECKLIST (before the shop runs on this)

- **Real shop details in Settings** (currently placeholders): Shop name **Mateen Traders**,
  phone **03099991500**, address **Pull 111 SB**. (These are provisional; owner confirms/updates
  before handover. `Settings.configuredAt` is currently NULL.)
- **Real opening stock counts:** every product's stock is currently a placeholder. Set to
  **1000** for now across the board; the owner sets true shelf counts just before handover
  (walk the shelves together). Milk is the exception — its stock is derived (starts 0, deliveries
  build it).
- **Receipt printer:** owner is buying one. **Recommend 80mm thermal** (standard for retail POS,
  cheap available paper, handles multi-item bills better than 58mm). Design the receipt for 80mm.
- **Real beverage prices, cooling charges, egg prices** entered by the owner.
- **Vercel:** ensure env has the current (rotated) DB password; consider Vercel Pro + backups.
- **Region co-location:** function is us-east, DB is Seoul (~1.1s/query). Consider moving the
  function to Seoul before go-live to cut latency (and to keep transactions comfortably inside
  their timeouts).
- **Backups:** free tier has ZERO automatic backups and no PITR. Before go-live, establish a
  real backup routine (Vercel Pro / Supabase paid tier, or a scheduled verified pg_dump).

---

## 6. HOW TO PICK UP (for the fresh Claude Code session)

1. Read `CLAUDE.md` fully — especially the DATABASE SAFETY section.
2. Read this file fully.
3. Confirm ground truth before ANYTHING: `git log -1` (expect HEAD at/after `cbcd2eb`),
   `npx prisma migrate status` (expect 9 migrations, "up to date"), and a read-only row-count
   check that the real data is intact (Saif, 2 real sales, farmer net owed 5000, 28 products
   incl. `prod_milk` at some stock).
4. The next stage is **S4**. It needs the two owner answers (Q1, Q3) — if the human has them,
   proceed to S4 recon/design; if not, ask for them first.
5. Work ONE stage at a time, gated: recon/design → human review → implement → test → commit.
   Never combine stages. Never skip the human-review gate on anything money- or
   farmer-adjacent or any migration.
6. After each stage, update `CLAUDE.md` if an invariant changed, and note progress.

---

## 7. QUICK REFERENCE — the real data that must never be harmed

| Record | Value |
|---|---|
| Customer | **Saif** (individual) |
| Farmer | **Saif** (phone 0309999150, Chak 104 Sb) |
| BakerySale | Rs. **5,000** (100 buns @ 50) |
| MilkSale | Rs. **6,000** (50 L @ 120) |
| Unified Sale (migration-A copy) | Rs. 5,000, 1 row |
| MilkDelivery | **250 L @ 30,000** (morning 100 + evening 150) |
| FarmerPurchase | Rs. **25,000** (biscuits) |
| **Farmer net owed** | Rs. **5,000** |
| Owner login | i228767@nu.edu.pk |
| Products | **28** (27 catalog + `prod_milk` at stock 0) |
| Migrations | **9**, latest `20260812120000_widen_product_stock` |