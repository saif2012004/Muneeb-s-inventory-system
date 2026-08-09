# The "5 vs 1" — reconciled. There are no 4 unexpected sales.

**Date:** 2026-08-09
**Status:** ⏸️ **STOPPED, as instructed.** Nothing built, Migration B untouched and still absent
from `prisma/migrations/`, nothing committed, nothing deleted.

---

## The headline: there is no discrepancy to resolve

The brief asks me to identify 4 unexpected sales. **They do not exist.** The new table holds
exactly one sale, and it is Saif's.

```
Sale rows              1
SaleItem rows          1
BeverageSale rows      0      BeverageSaleItem rows  0
BakerySale rows        1      BakerySaleItem rows    1
Customers              1      (Saif)
MilkSale rows          1
```

This matches what I reported after Migration A — 1 sale, 1 line — so nothing has changed since the
checkpoint. I have not deleted anything: the counts were 1 then and are 1 now.

### Where the "5" almost certainly came from

`_prisma_migrations` contains exactly **5** rows, and the `prisma migrate deploy` output I ran in
the previous step opens with:

> `5 migrations found in prisma/migrations`

The five:

```
20260802201127_init
20260803000000_enable_rls
20260809000000_add_sale_discount_percent
20260809120000_add_product_stock
20260809180000_unify_sale_tables_part_a
```

Five **migrations**, one **sale**. That is the 5-vs-1, and it is not a data problem.

I would rather say this plainly than produce a list of four sales that aren't there. If you are
seeing "5" somewhere I haven't looked — a screen, a query, an export — tell me where and I'll go
at it directly, because on the database itself there is one sale and it reconciles.

---

## 1. The sales, in full

Every row, nothing summarised. There is one.

| Field | Value |
|---|---|
| sale id | `cmsjh3kly0002uve8ajkvs2ji` |
| customer | **Saif** |
| saleDate | 2026-08-07 19:00:00 |
| bill discount | 0.00 |
| **total** | **5000.00** |
| notes | (null) |
| line id | `cmsjh3kly0004uve8zootrgoy` |
| **module** | **bakery** |
| product | Buns |
| quantity | 100 |
| unitPrice | 50.00 |
| line discount | 0.00 |
| lineTotal | 5000.00 |
| **netLineTotal** | **5000.00** |
| **Is it test data?** | **No** |

### Test-data sweep

Nothing `ZZ_TEST_`-prefixed survives anywhere:

| | |
|---|---|
| Customers named `ZZ_TEST%` | **0** |
| Products named `ZZ_TEST%` | **0** |
| Farmers named `ZZ_TEST%` | **0** |
| Sales with `ZZ_TEST` in notes | **0** |
| Full customer list | **Saif** — one row |

So there is nothing to decide about keeping or deleting. The only sale in the database is real,
and it is the one that has been there since before any of this work started.

---

## 2. Per-sale reconciliation — every sale, not just Saif's

The same check the migration enforced, shown per sale:

| sale id | totalAmount | Σ netLineTotal | reconciles | lines | valid module | bad module | modules |
|---|---|---|---|---|---|---|---|
| `cmsjh3kly0002uve8ajkvs2ji` | 5000.00 | **5000.00** | **true** | 1 | 1 | **0** | bakery |

`Σ netLineTotal = totalAmount` holds, `moduleKey` is set and valid on every line, and no line has a
null or unrecognised module. Across all sales in the table — which is this one.

---

## 3. Old ↔ new cross-check, both directions

This is the check you were right to insist on while the old tables still exist. I ran it in both
directions and on every field, not just counts:

| Check | Result |
|---|---|
| legacy sales / new sales | **1 / 1** |
| legacy items / new items | **1 / 1** |
| **DROPPED** — legacy sale ids missing from `Sale` | **0** |
| **DROPPED** — legacy item ids missing from `SaleItem` | **0** |
| **INVENTED** — `Sale` ids with no legacy row | **0** |
| **INVENTED** — `SaleItem` ids with no legacy row | **0** |
| **ALTERED** — sales differing on customerId / saleDate / discountPercent / totalAmount | **0** |
| **ALTERED** — items differing on saleId / productId / quantity / unitPrice / discountPercent / lineTotal | **0** |
| **MODULE MISMATCH** — `moduleKey` ≠ the table the row came from | **0** |

The "invented" direction is the one that would have caught four phantom sales, and it returns
zero. Every row in the new tables traces back to a legacy row by id, with identical field values,
and every legacy row has a counterpart. Nothing dropped, nothing invented, nothing altered.

The module check is worth calling out separately: it verifies that a row copied from `BakerySale`
carries `moduleKey='bakery'` and one from `BeverageSale` carries `'beverages'` — the actual thing
the merge had to get right, checked against the source table rather than assumed from the INSERT
that wrote it.

---

## Where this leaves us

The new tables' contents are confirmed correct against the old ones. Nothing needs deleting and
nothing is unaccounted for.

Still stopped, and still holding:

| | |
|---|---|
| Migration B | **not written, not in `prisma/migrations/`** |
| Build (API / form / edit UI / reports) | not started |
| Committed | no |
| App behaviour | unchanged — nothing reads `Sale`/`SaleItem` yet |

Your call on what happens next. If the "5" turns out to be the migration count, then step 3 (the
unified API and onward) is clear to start whenever you say. If you are seeing five of something
else, point me at it first.

---

### Note: Context7 is back

It reconnected this session, after **11 consecutive failures**. Nothing in this turn needed it —
this was pure database reconciliation, no library APIs and no code written — so everything above
came from direct queries against the live database. I'll use it properly on the build step, which
is the first thing since it came back that touches Prisma and shadcn APIs.

The Phase 8 item to diagnose the connection can probably be closed, but I'd leave it open until it
survives a few sessions, since a single reconnect isn't evidence the underlying problem is fixed.
