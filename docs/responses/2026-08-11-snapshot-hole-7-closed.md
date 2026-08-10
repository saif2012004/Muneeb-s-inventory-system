# Docs restored + snapshot hole #7 closed and verified

**Date:** 2026-08-11
**Commit:** `62cf0d2` — pushed to `main`
**Frontend pass:** not started. **Unified-sale question:** untouched, held as instructed.

---

## 1. Docs restored ✅

```
before:  58 files under docs/ showing as deleted
$ git checkout -- docs/
after:   0
```

**All 58 back**, including the full phase trail from `phase-2.1-api-routes.md` onward.
`docs/responses/` now holds **55** files.

**Nothing else in the tree is deleted** — `git status --short | grep '^ D\|^D '` returns nothing at
all. The only remaining entries are the untracked response docs from this session.

The evidence trail was never committed away: the deletions only ever existed in the working tree,
and the two commits I made staged explicit file lists, never `git add -A`.

---

## 2. Snapshot hole #7 — closed ✅

### The change

`reconcileSaleLines()`, update branch — `line.unitPrice` is no longer read at all for an existing
line:

```ts
// before
const unitPrice =
  line.unitPrice !== undefined
    ? new Prisma.Decimal(line.unitPrice)   // client price wins
    : productChanged ? product.price : prior.unitPrice;

// after
const unitPrice = productChanged ? product.price : prior.unitPrice;
```

Database when the line became a different product, stored snapshot otherwise. The
`repricedItemIds` condition simplified with it — a re-price is now exactly "the product changed and
the price actually moved", with no client-override case to exclude.

**Create is untouched.** `snapshotUnitPrice()` still honours an override and is now documented
**create-only**, with the reason on the function itself.

`saleItemUpdateSchema` still *accepts* `unitPrice` rather than rejecting it — `NewSaleForm` always
sends one, and a new line in the same array legitimately uses it. It is simply inert for a line
with an `id`. I noted that in the schema, because "the schema accepts a field the code ignores" is
exactly the kind of gap someone later tightens into a 400 that breaks every edit.

### Verification — authenticated HTTP, as specified

There is no edit UI, so the route was exercised directly. Session obtained through the real
`/api/auth/no-js-login` endpoint, giving a genuine `authjs.session-token` cookie.

**Fixture:** a `ZZ_TEST_` beverage sale, 2 × Pepsi 1.5L at a stored snapshot of **275.50** =
Rs. 551.00.

#### Test 1 — quantity-only change, bogus client price

```
PATCH  items:[{ id: <line>, productId: prod_pepsi_1_5l, quantity: 5, unitPrice: 9999.99 }]
```

| | Result |
|---|---|
| `unitPrice` | **275.50** — stored snapshot preserved ✅ |
| `lineTotal` | **1377.50** = 5 × **275.50** ✅ |
| `totalAmount` | 1377.50 |
| `repricedItemIds` | `[]` ✅ |

**Had the hole still been open, `lineTotal` would have been 5 × 9999.99 = 49,999.95.**
Confirmed in the database, not just the response: `unitPrice 275.50`, `lineTotal 1377.50`.

#### Test 2 — product swap, bogus client price

Swapped to `Big Apple 0.5L`, catalog price **120.00**, sending `unitPrice: 1.00`.

| | Result |
|---|---|
| `unitPrice` | **120.00** — from the **database** ✅ |
| | not `1.00` (client) and not `275.50` (old snapshot) |
| `lineTotal` | **600.00** = 5 × 120 ✅ |
| `repricedItemIds` | `["zztestpatchitem…"]` — correctly reports the re-price ✅ |

This is the branch that must still re-snapshot, and it does — from the right source.

#### Test 3 — CREATE still honours the override

The other half of the asymmetry, checked so the fix can't have broken billing on 0-priced products:

```
POST  items:[{ productId: prod_pepsi_1l, quantity: 2, unitPrice: 300 }]     (catalog price 0.00)
```

| | Result |
|---|---|
| `unitPrice` | **300.00** — honoured ✅ |
| `lineTotal` | 600.00 |

*(First attempt returned `{"data":null,"error":"Invalid input"}` — the create schema requires
`saleDate` and `discountPercent`. Not a bug; my request body was incomplete.)*

**All three branches behave exactly as specified.**

`tsc --noEmit` exit 0, `next lint` clean.

### Why now rather than with #8

With no caller, the change cannot regress anything — there is literally nothing that PATCHes a
beverage or bakery sale today. After #8 ships it would have been a live data bug, and a quiet one:
`NewSaleForm.tsx:218` carries the comment *"unitPrice is ALWAYS sent"*, so an edit screen built on
that form would have re-priced a closed bill every time the owner corrected a quantity, with
nothing in the response to show it had happened.

---

## 3. CLAUDE.md updated in the same commit

| Section | Change |
|---|---|
| Snapshot rule table | Last row flipped: an explicit `unitPrice` on an **existing** line is now **IGNORED**. Product-changed row clarified as re-snapshotting **from the database** |
| New: create/update asymmetry note | Why create keeps the override and update refuses it, and an explicit *"do not 'fix' this for symmetry"* |
| "The one un-hardened edge" | Replaced with the closed record — kept, rather than deleted, so nobody re-opens it |
| CHECKLIST #7 | `[ ]` → **`[x]` CLOSED 2026-08-11** |

---

## 4. Held, as instructed

**The unified-sale question is untouched.** No tables dropped, nothing built, `Sale`/`SaleItem`
left dormant. CLAUDE.md's `🧭 WHICH SALE TABLES ARE LIVE` section stays prominent with its
re-verification stamp and the "the grep wins over any brief" rule.

That is the right call for a reason worth recording: it hinges on whether the client actually needs
Pepsi-and-buns on one bill, which is a client requirement, not a technical judgement. My earlier
recommendation to abandon was made without that input and shouldn't outweigh it.

---

## 5. State

**HEAD:** `62cf0d2`, pushed.

```
62cf0d2  fix: server-authoritative unitPrice on sale PATCH (close snapshot hole #7)
dda6ab7  chore: commit discount-drop, track migrations A+drop, reconcile CLAUDE.md to repo
873054e  fix: login POST-only, no credentials in URL on no-JS fallback
```

**Database — back to baseline, verified by fingerprint:**

| | |
|---|---|
| `Product` | 27, md5 `95794a0bb44f1b15d541a60ef0bd5c51` — identical to the pre-test baseline |
| `Customer` | 1 — `Saif` |
| `BeverageSale` | 0 · `BakerySale` 1 (Rs. 5,000) · `MilkSale` 1 (Rs. 6,000) |
| `User` | 1 — `i228767@nu.edu.pk` |

All `ZZ_TEST_` rows removed (user, customer, two sales and their lines), and product stock restored
to 100 after the test sales decremented it.

**Working tree:** clean apart from this session's untracked response docs.

---

## What's left

**Closed this session:** #7. **Previously closed:** #1 (login), #9 (discount column), #16
(untracked migrations).

**Next, per your sequencing:** the frontend elevation — the prompt is drafted in
`docs/responses/2026-08-11-frontend-elevation-prompt.md`, including the two decisions it gates
(dark mode, and `framer-motion` vs `motion`). Then #10–13.

**Held:** unification, pending the client's answer on cross-category bills.

**Go-live blockers, unchanged:** #2 data reset (2 sales, 1 customer, and the owner's real stock
counts), #2b real shop details (`configuredAt` still `NULL`), #3 Vercel Pro + Supabase backups —
plus #14 region co-location, worth doing in the same sitting.
