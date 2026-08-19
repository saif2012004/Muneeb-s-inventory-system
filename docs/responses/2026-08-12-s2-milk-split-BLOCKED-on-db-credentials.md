# S2 — milk-sale split done and statically verified. **NOT COMMITTED: browser verification blocked.**

**Date:** 2026-08-12
**HEAD:** `fa18e16` (unchanged — nothing committed)
**Code change:** complete, `tsc`/lint/build green, move proven byte-identical.
**Blocker:** 🔴 **the database password has been rotated. Prisma can no longer connect, so the app
will not run and the browser verification the brief requires cannot be performed.** Details in §4.

I stopped rather than committing against an incomplete verification gate. **Nothing was guessed and
no data was harmed.**

---

## STEP 1 — Export inventory (re-verified against the current file)

`lib/milk.ts` had **18 exports**. Classification, with what each actually references:

### Milk-SALE (2) — moved

| Export | Line | Tables/models | DB calls | Uses shared helpers? |
|---|---|---|---|---|
| `MILK_SALE_SELECT` | 80 | a `MilkSale` **select shape** only | **none** | no |
| `computeMilkSaleTotal` | 161 | none — pure `Decimal.mul` | **none** | no |

### FARMER (16) — untouched, still in `lib/milk.ts`

| Export | Line | Tables |
|---|---|---|
| `DELIVERY_SELECT` | 57 | `MilkDelivery` shape |
| `PURCHASE_SELECT` | 70 | `FarmerPurchase` shape |
| `computeDeliveryTotals` | 121 | pure (delivery domain); uses `ZERO` |
| `FarmerBalance` (type) | 172 | — |
| `FarmerBalanceTone` (type) | 193 | — |
| `farmerBalanceTone` | 195 | pure |
| `getFarmerBalance` | 210 | **`milkDelivery`, `farmerPurchase`** |
| `getFarmerBalances` | 246 | **`milkDelivery`, `farmerPurchase`** |
| `FarmersSummary` (type) | 312 | — |
| `summariseFarmerBalances` | 323 | pure |
| `getAllFarmerTotals` | 369 | **`milkDelivery`, `farmerPurchase`** |
| `FarmerLedgerEntry` (type) | 410 | — |
| `FarmerActivity` (type) | 423 | — |
| `getFarmerActivity` | 446 | **`milkDelivery`, `farmerPurchase`** |
| `summariseFarmerActivity` | 492 | pure |
| `buildFarmerLedger` | 529 | pure |

**Every `prisma.*` call in the entire file is `milkDelivery` or `farmerPurchase`** — all farmer. The
two milk-sale exports make no database call at all.

### Entanglement check: **none.** Verified by line number, not by eye.

The file has three module-level non-exported helpers. Their usage sites:

```
ZERO       94 142 257 258 259 260 328 329 330 331 332 386 392 396 397 493 494 503 562
sumOrZero  224 225 231 284 285 292 386 392
laterOf    500 508
```

The milk-sale exports occupy lines **80–90** and **161–166**. **Not one helper usage falls inside
either range.** `computeMilkSaleTotal` needs only `Prisma` from `@prisma/client`; it does not even
need the `prisma` client singleton.

So there was nothing to disentangle and nothing to propose — the split is clean.

---

## STEP 2 — The split

**New file `lib/milk-sales.ts`** holding the two exports, plus a docblock recording why the boundary
exists and that it is a file boundary now rather than a comment.

**Proven byte-identical** — diffed the moved code against `git show HEAD:lib/milk.ts`:

```
MILK_SALE_SELECT:     IDENTICAL ✓
computeMilkSaleTotal: IDENTICAL ✓
```

**No function body changed. Nothing was "improved" while moving.**

**`lib/milk.ts`**: 571 → 545 lines, **all 16 farmer exports still present** at the expected
positions. Farmer bodies untouched.

**Import updates — 2 files, one line each.** Both imported *only* the two moved exports, so there
were no mixed imports to split:

```diff
- import { MILK_SALE_SELECT, computeMilkSaleTotal } from "@/lib/milk";
+ import { MILK_SALE_SELECT, computeMilkSaleTotal } from "@/lib/milk-sales";
```

`app/api/milk/sales/route.ts:5` · `app/api/milk/sales/[id]/route.ts:4`

**Boundary holds both ways:**

| | |
|---|---|
| `milk-sales.ts` imports `lib/milk`? | **NO** ✓ |
| `milk.ts` imports `milk-sales`? | **NO** ✓ |
| Any importer still pointing at the old path for these two? | **none** ✓ |

---

## STEP 3 — Static verification (all green)

| Check | Result |
|---|---|
| `tsc --noEmit` (4096 heap) | **exit 0** |
| `next lint` | **clean** |
| `npm run build` | **green** |
| Moved code byte-identical | **yes**, both exports |
| Farmer exports intact | **16/16** |

---

## STEP 4 — 🔴 THE BLOCKER: database credentials are no longer valid

Browser verification could not be performed. Not a symptom of this change — the app cannot reach the
database at all.

**What the server actually reported**, after I chased a login failure that first looked like a wrong
password:

```
[auth][cause]: PrismaClientInitializationError:
Invalid `prisma.user.findUnique()` invocation:

Authentication failed against database server, the provided database
credentials for `postgres` are not valid.
```

**Both connection strings fail**, including the direct one:

```
$ npx prisma migrate status
Error: P1000: Authentication failed against database server, the provided
database credentials for `postgres` are not valid.
```

| | user | host |
|---|---|---|
| `DATABASE_URL` | `postgres.wcfdtxalwlztfsbepkrr` | `aws-1-ap-northeast-2.pooler.supabase.com:6543` |
| `DIRECT_URL` | `postgres.wcfdtxalwlztfsbepkrr` | `aws-1-ap-northeast-2.pooler.supabase.com:5432` |

### This changed *today*, between two things I ran myself

`prisma migrate deploy` succeeded roughly an hour earlier — that is how Migration C was applied,
over `DIRECT_URL`. So the credential was valid then and is not now.

**Most likely cause: the password was reset while taking the manual backup.** Getting a connection
string for `pg_dump` from the Supabase dashboard commonly involves resetting the database password,
which silently invalidates every stored copy.

### ⚠️ Vercel is stale too — worth knowing beyond this task

I pulled the project's current Vercel env (to a temp file, **not** over `.env`) and compared the
password by hash, without exposing it:

```
DATABASE_URL   local=3a492e16da33   vercel=3a492e16da33   SAME
DIRECT_URL     local=3a492e16da33   vercel=3a492e16da33   SAME
```

**Vercel holds the same now-invalid credential.** So the deployed app cannot reach the database
either. Production is only a Phase 1 build and nobody is using it, but any preview or production
deploy will fail until Vercel's env is updated too.

### What I did NOT do

No credential guessing, no rewriting `.env` with anything invented, no attempt to reset the password
myself. `.env` is **unchanged** — I only copied it aside and pulled Vercel's copy to a scratch path
for comparison.

### To unblock

1. Supabase dashboard → **Project Settings → Database → get the current password** (reset it again
   if it isn't recorded anywhere).
2. Update `DATABASE_URL` and `DIRECT_URL` in local `.env` — keeping
   `?pgbouncer=true&connection_limit=1` on the pooled one.
3. Update the same two in **Vercel** (Preview + Production), or the deployed app stays broken.
4. Tell me, and I'll finish the S2 verification and commit — it is about five minutes of work.

---

## Data integrity — verified via the Supabase MCP, which uses a different auth path

| | |
|---|---|
| `Product` | **27**, fingerprint `95794a0bb44f1b15d541a60ef0bd5c51` — **unchanged all session** |
| `Customer` | **1** — `Saif` |
| `BakerySale` | 1 @ **Rs. 5,000** · `MilkSale` 1 @ **Rs. 6,000** · `BeverageSale` 0 |
| `SaleItem.quantity` | `100.00` — Migration C's row, still reconciling |
| **`Farmer`** | **1** — `Saif` |
| **`MilkDelivery`** | **250.00 L @ Rs. 30,000** |
| **`FarmerPurchase`** | **Rs. 25,000** |
| **Farmer net owed** | **Rs. 5,000** — identical to the baseline taken before the split |
| `User` | 1 — `i228767@nu.edu.pk` |

**Farmer data is untouched**, which is the point of this stage. `ZZ_TEST_` rows created during the
attempt (a user and a customer) have been removed. **No farmer table was ever written to.**

---

## What remains unverified, stated plainly

The brief requires these before committing, and I could not do them:

- [ ] Farmer surfaces in a browser: balances, ledger, quick-entry, balance sheet, farmer profile
- [ ] A `ZZ_TEST_` milk sale created through the dialog and confirmed correct

Both are blocked purely by the credential failure. I could reach the routes' HTTP layer but every
one returned a redirect to login, because sign-in itself needs the database.

**Two independent reasons I expect them to pass once credentials are restored** — offered as
reasoning, not as a substitute for the check:

1. The moved code is byte-identical and the only other edit is two import paths.
2. No farmer symbol, file or table was touched — the 16 farmer exports never moved, and
   `lib/milk-sales.ts` cannot import from `lib/milk.ts`.

---

## State

**Nothing committed. HEAD is still `fa18e16`.** Uncommitted:

```
 M lib/milk.ts                         (2 blocks removed; 16 farmer exports intact)
 M app/api/milk/sales/route.ts         (import path)
 M app/api/milk/sales/[id]/route.ts    (import path)
?? lib/milk-sales.ts                   (the 2 moved exports)
```

Say the word once credentials are restored and I'll run the browser pass and commit as
`refactor: split milk-sale code out of lib/milk.ts (isolate from farmer code)`. If you'd rather I
commit now on the static evidence and verify after, that's fine too — just tell me, since the brief
put the commit behind the verification gate.

---

## Constraint compliance

| Constraint | Status |
|---|---|
| No logic changes — pure move + import-path updates | ✅ byte-identical, proven by diff |
| Farmer function bodies / tables / UI / `/api/milk/farmers/**` untouched | ✅ never edited; farmer data verified unchanged |
| No schema changes, no migrations, no DB writes | ✅ the only writes were creating and deleting `ZZ_TEST_` rows for the blocked login attempt |
| No `Sale`/`SaleItem` work, no unified checkout, no stock bridge | ✅ |
| No dependency installs/removals | ✅ |
