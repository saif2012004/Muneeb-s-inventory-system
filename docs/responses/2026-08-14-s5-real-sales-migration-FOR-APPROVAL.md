# S5 — migrating the real sales into the unified tables. **FOR YOUR APPROVAL. NOTHING APPLIED.**

**Date:** 2026-08-14 · **Status: 🔴 STOPPED at the gate.** No data has been written.
This stage touches your real money records, so it stops here by rule — and by my own judgement.

**What I did do:** read-only analysis of the exact rows, and one **code** change shipped ahead of the
data (`65cfdfa`) so the apply can't briefly make your numbers wrong. See §4.

---

## 1. Half of S5 turns out to be already done — and correct

I compared migration A's copy against the live bakery sale field by field:

| | `BakerySale` | `Sale` (A's copy) | |
|---|---|---|---|
| id | `cmsjh3kly0002uve8ajkvs2ji` | **same** | ✅ |
| customer | Saif | same | ✅ |
| saleDate | 2026-08-07 19:00 | same | ✅ |
| totalAmount | 5000.00 | 5000.00 | ✅ |
| createdAt | 2026-08-07 21:44:53.014 | **original preserved** | ✅ |

| | `BakerySaleItem` | `SaleItem` | |
|---|---|---|---|
| id / product | `…0004uve8zootrgoy` / Buns | same / same | ✅ |
| quantity × unitPrice | 100 × 50.00 | 100.00 × 50.00 | ✅ |
| lineTotal | 5000.00 | 5000.00 | ✅ |
| moduleKey · netLineTotal | — | **`bakery` · 5000.00** | ✅ |

**Nothing to do for bakery.** The beverage table is empty. **S5 is one milk sale.**

---

## 2. What the apply would do — exactly

`MilkSale cmsjh84mt0009uve8xh13m74k` — Saif, 2026-08-07, **50 L × Rs. 120 = Rs. 6,000** — has no
unified copy. It needs one `Sale` + one `SaleItem`, following migration A's pattern exactly:
**same id, original timestamps preserved.**

```sql
-- S5. TWO INSERTS. No UPDATE, no DELETE, nothing existing is touched.
BEGIN;

INSERT INTO "Sale" (id, "customerId", "saleDate", "discountPercent", "totalAmount", notes, "createdAt")
SELECT m.id, m."customerId", m."saleDate", 0, m."totalAmount", m.notes, m."createdAt"
FROM "MilkSale" m
WHERE m.id = 'cmsjh84mt0009uve8xh13m74k'
  AND NOT EXISTS (SELECT 1 FROM "Sale" s WHERE s.id = m.id);

INSERT INTO "SaleItem" (id, "saleId", "productId", "moduleKey", quantity, "unitPrice",
                        "discountPercent", "lineTotal", "netLineTotal")
SELECT m.id, m.id, 'prod_milk', 'milk', m.liters, m."ratePerLiter", 0, m."totalAmount", m."totalAmount"
FROM "MilkSale" m
WHERE m.id = 'cmsjh84mt0009uve8xh13m74k'
  AND NOT EXISTS (SELECT 1 FROM "SaleItem" i WHERE i.id = m.id);

COMMIT;
```

**Every value is copied from the row itself**, never retyped — that is why the statements read from
`MilkSale` instead of carrying literals. `50 × 120 = 6000` is arithmetic I would otherwise be
re-doing by hand on your money.

**Three decisions in there worth naming:**

- **The `SaleItem` reuses the sale's id.** A `MilkSale` has no line, so there is no original line id to
  preserve. Ids only need to be unique *within* `SaleItem`, and reusing this one makes the row's
  origin obvious forever. The alternative — a fresh cuid — is untraceable back to the milk sale.
- **`NOT EXISTS` on both** makes the script safe to run twice. Re-running it does nothing.
- **`discountPercent` 0**: a milk sale never had one, and `netLineTotal = lineTotal = 6000.00`
  because there is no bill discount to apportion.

### 🔴 What it deliberately does NOT do: touch stock

`prod_milk.stock` is **0** and stays 0. This is a *historical* sale from before the stock bridge
existed — its litres were never added to stock, so taking them out would drive the figure to **−50**
and describe a fridge that never existed. Raw SQL runs no application stock logic, so this is the
default; I am stating it because "sales decrement stock" is exactly the rule someone would helpfully
"fix" this to obey.

---

## 3. Why this changes no number on any screen

After the apply, the milk sale exists in `MilkSale` **and** in `Sale`. The dedupe rule excludes any
`Sale` whose id appears in an old table, so every figure keeps reading the old row:

| | Before | After |
|---|---|---|
| Saif's balance | 11,000 | **11,000** |
| Reports total revenue | 11,000 | **11,000** |
| `Sale` / `SaleItem` rows | 1 / 1 | 2 / 2 |

**That is the whole point of S5: it is staging, not switching.** The copies sit ready so that when
S9 drops the old tables, nothing is lost and the dedupe rule simply stops matching anything.

---

## 4. The code that had to ship FIRST — and did (`65cfdfa`)

The dedupe rule only excluded ids found in `BeverageSale`/`BakerySale`. **The milk copy would have
been counted twice the instant it landed** — Saif at 17,000, revenue at 17,000 — for as long as it
took the code to follow.

So the guard now also excludes ids present in `MilkSale`. It is a **no-op today** (no `Sale` row
shares an id with a `MilkSale` row), verified over HTTP: balance 11,000, bakery 5,000, milk 6,000,
total 11,000 — unchanged. The order matters more than the change: **the data step must never be the
thing that makes the numbers wrong.**

---

## 5. Backups — read this before you say go

**There is a real, complete backup, but it is not of today's database.**

| | `../backup2.sql` |
|---|---|
| Verified by CONTENTS, not existence | ✅ `Saif` present, **18 `COPY` data blocks**, both `5000.00` and `6000.00` present |
| Ends with `-- PostgreSQL database dump complete` | ✅ |
| Taken | **2026-08-12 00:37** |
| Knows Migration D (`widen_product_stock`) | ❌ **no** |
| Knows `prod_milk` | ❌ **no** |

So it protects **your irreplaceable business data** — the rows in it are byte-identical to today's,
since none of them has changed — but restoring it would roll the schema back to 8 migrations and lose
`prod_milk`. It is a data safety net, not a point-in-time restore.

**`pg_dump` is not installed on this machine**, so I cannot take a fresh one for you.

**My honest read of the risk:** this particular apply is **two INSERTs of two brand-new rows with
known ids**. It updates nothing, deletes nothing, and is undone exactly by:

```sql
DELETE FROM "SaleItem" WHERE id = 'cmsjh84mt0009uve8xh13m74k';
DELETE FROM "Sale"     WHERE id = 'cmsjh84mt0009uve8xh13m74k';
```

That rollback is complete — the old `MilkSale` row is never touched, so the record of the sale
survives either way. **This is the safest write this project has ever proposed.** I would still
rather you had a current dump before we start writing to the real tables at all, because the *next*
gated stage (S9's Migration B, which DROPS four tables) genuinely needs one.

---

## 6. Verification I would run immediately after (all read-only)

1. `Sale` = 2, `SaleItem` = 2, `MilkSale` still 1, `BakerySale` still 1.
2. The copy reconciles **to the paise**: `totalAmount` 6000.00, `quantity` 50.00, `unitPrice` 120.00,
   `netLineTotal` 6000.00, `moduleKey` `milk`, and `50 × 120 = 6000` checked in SQL.
3. `createdAt` preserved as `2026-08-07 21:48:25.589` — a migrated row must not look like it was
   sold today.
4. **Saif still 11,000** and reports still 11,000 — the dedupe holding.
5. Product fingerprint `b57a51bb…` unchanged and `prod_milk.stock` still **0.00**.
6. Farmer net owed still **5,000** — untouched by anything here.

---

## 7. What I need from you

**Reply with one of:**

- **"apply S5"** — I run the two INSERTs and the six checks above, and report. Roughly two minutes.
- **"apply S5 after a backup"** — you take a fresh dump first (needs PostgreSQL client tools
  installed, or the Supabase dashboard's export), tell me it's done, and I apply.
- **"skip S5 for now"** — entirely reasonable. Nothing depends on it until S9, and the app is
  complete and correct without it. I move to the on-screen per-product table or the edit screen
  instead.

**I will not run the INSERTs without one of those.**
