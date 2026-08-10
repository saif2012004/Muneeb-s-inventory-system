# Committed + pushed, and a decision-ready summary of what's actually left

**Date:** 2026-08-11
**Commit:** `dda6ab7` — pushed to `main`
**Frontend pass / rework:** not started, as instructed.

---

## 1. The commit — done ✅

```
dda6ab7  chore: commit discount-drop, track migrations A+drop, reconcile CLAUDE.md to repo
         19 files changed, 874 insertions(+), 106 deletions(-)
```

**Contents, as specified:**

| | |
|---|---|
| Item #9 | The `discountPercent` drop — migration + 13 code files, applied and browser-verified |
| CLAUDE.md | The six figure fixes + the "grep wins" note |
| #16 | **Both** untracked migration directories now tracked |
| Evidence | Two response docs (the #9 verification, the ground-truth audit) |

**Pre-flight:** `tsc --noEmit` exit 0, `next lint` clean.

### Verification you asked for

**Secrets ignored:**
```
.env               IGNORED ✓
.env.local         IGNORED ✓
.vercel/project.json  IGNORED ✓
```

**All applied migrations now tracked in git:**
```
✓ 20260802201127_init
✓ 20260803000000_enable_rls
✓ 20260809000000_add_sale_discount_percent
✓ 20260809120000_add_product_stock
✓ 20260809180000_unify_sale_tables_part_a          ← was untracked
✓ 20260810120000_add_settings
✓ 20260810180000_drop_product_discount_percent     ← was untracked
```

**Git and the database agree:**
```
$ npx prisma migrate status
7 migrations found in prisma/migrations
Database schema is up to date!
```

**The fresh-clone hazard is gone.**

### One thing I did NOT commit, deliberately

`git status` is **not** fully clean: **58 tracked files under `docs/` still show as deleted.**
That deletion predates this session — it was already in the working tree when I started, and it is
not mine. I staged only my own 19 files. It's your call whether those docs were removed
intentionally; if not, `git checkout -- docs/` restores them.

---

## 2. What's actually left

### (a) GO-LIVE BLOCKERS — real, and all small

| # | Item | Size | Notes |
|---|---|---|---|
| **2** | **Data reset** | ~15 min | **2 sales, 1 customer.** Delete: `BakerySale` (Rs. 5,000) + its 1 item, `MilkSale` (Rs. 6,000), `Sale`/`SaleItem` (the migration-A copy), customer `Saif`. **Keep:** owner account, 27 catalog products with real prices. **The subtle part is stock** — all 27 products sit at the migration default of `100`, which is not a real count. That's the owner's shelf-walk, not a number for us to invent |
| **2b** | **Real shop details** | ~5 min, owner's input | Verified still unset today: `configuredAt IS NULL`, `shopName = 'SET SHOP NAME IN SETTINGS'`. The screen exists and works; the owner just types three fields. **Confirm the receipt paper width first** — the 32-char cap derives from an *assumed* 58mm roll (`RECEIPT_LINE_CHARS`); if it's 80mm, change that constant to 48 and the cap follows |
| **3** | **Vercel Pro + Supabase backups** | billing, ~10 min | Hobby forbids commercial use; free Supabase keeps **zero backups** and pauses after 7 days idle |

**These three are the whole go-live gate.** None is a code problem. Realistically one sitting with
the owner present.

Worth doing at the same time, cheap: **#14 region co-location** — flip the Vercel function region to
`icn1` (Seoul). One setting, and it's the single highest-value performance change available
(~1.07s/query today, function in Washington DC, database in Seoul).

---

### (b) SNAPSHOT HOLE #7 — **not a live bug today. It's a landmine for later.**

**Short answer: not exploitable in the current app.** The vulnerable code is real, but nothing can
reach it.

**The hole itself**, `lib/sales.ts:204` and the update branch at `:474`:

```ts
export function snapshotUnitPrice(product, override) {
  return override === undefined ? product.price : new Prisma.Decimal(override);
}
// …in reconcileSaleLines' update branch:
const unitPrice = line.unitPrice !== undefined
  ? new Prisma.Decimal(line.unitPrice)   // client price wins on PATCH
  : productChanged ? product.price : prior.unitPrice;
```

**Why it isn't reachable:**

| Path | Status |
|---|---|
| Beverages/bakery sale **edit UI** | **Does not exist.** `lib/hooks/use-sales.ts` exports `useSales`, `useSale`, `useCreateSale`, `useDeleteSale` — **no `useUpdateSale`**. The `PATCH` route is complete and server-verified with no client at all |
| Milk sale edit (`useUpdateMilkSale`) | Exists, but **not an instance of this hole**. `MilkSale` has no products and no line items — it's `liters × ratePerLiter`, both typed fresh. There is no catalog price to snapshot, so the rule doesn't apply |
| Crafted HTTP `PATCH` | Possible **only with a valid owner session**. Middleware 401s everything else, and this is a single-owner app: the only account is the owner's |

So today the "attacker" and the "victim" are the same person, acting deliberately, on their own
data. That is not a security bug.

**Where it becomes a real bug: the moment CHECKLIST #8 (sale edit UI) ships.** If that screen reuses
`NewSaleForm`, note `components/sales/NewSaleForm.tsx:218`:

```
// unitPrice is ALWAYS sent: the owner may be pricing a 0-priced …
```

It **always** sends `unitPrice`. So an edit screen built on it would resend whatever price sits in
the form — and correcting "12 crates" to "15" on a months-old sale would silently re-price that
line at today's value, moving the total of a closed bill. That is precisely the mutation the
snapshot rule exists to prevent, and it would arrive quietly.

**Recommendation:** fix it **now**, while it's a one-branch change and cannot regress anything (no
caller). Keep the override on **create** — the seed ships every product at price 0, so the owner
must be able to bill a real price before walking the catalog — and ignore it on **update**, so the
server always re-reads `product.price` for a re-snapshotting line. ~10 lines in one function, plus
updating the rule table in CLAUDE.md in the same commit.

---

### (c) UNIFIED SALE + Migration B + receivables — scope, and my recommendation

**This is a rework bundle, not cleanup. Here's the honest size.**

#### What already exists and is reusable unchanged — the good news

`lib/sales.ts` (718 lines) is almost entirely **module-agnostic pure logic**, already written and
verified:

`reconcileSaleLines` · `computeLineTotal` · `applySaleDiscount` · `computeSaleTotal` ·
`roundMoney` · `checkTotalFits` · `computeStockDeltas` · `findStockShortfalls` ·
`applyStockDeltas` · `loadSaleProducts` · `snapshotUnitPrice` · `SALE_DETAIL_SELECT` ·
`SALE_LIST_SELECT`

**None of that needs rewriting.** The hardest, most dangerous code — discount stacking, price
snapshot, stock delta reconciliation — is done. That genuinely de-risks the build.

`components/sales/NewSaleForm.tsx` (572 lines) is already parameterised by a `SaleModule` config,
so it adapts rather than gets rewritten.

#### What has to be built or repointed

| Work | Files / size | Nature |
|---|---|---|
| Unified `POST`/`GET` + `PATCH`/`DELETE` endpoints | ~250 + ~330 lines | **Mostly a port.** The two existing per-module route pairs (224/317 and 222/310 lines) are near-identical; they collapse into one |
| **`moduleKey` per line** | form + API | **New.** The picker currently filters to one category and `loadSaleProducts` *rejects* cross-category lines. A unified picker must show both catalogs and derive `moduleKey` from each product |
| **`netLineTotal` apportionment** | new arithmetic | **The genuinely novel and risky piece.** The whole-bill discount must be spread pro-rata across lines with the residue on the largest, and it must reconcile exactly with `computeSaleTotal` — or reports stop summing to sale totals. Money code, needs its own tests |
| Reports rewrite | `lib/reports.ts` (440 lines) | From `SUM("totalAmount")` per table → `Σ netLineTotal GROUP BY moduleKey`. This is *why* `netLineTotal` exists. Includes the 6 raw-SQL refs |
| `lib/receivables.ts` | 480 lines, 8 importing routes | Repoint or delete. Deleting means also deciding the fate of `CustomerPayment` and the payments routes |
| `lib/receipt.ts` | 169 lines, 2 calls | Small repoint |
| `lib/catalog-guards.ts` | 119 lines, 4 calls | Small repoint |
| CSV export | 369 lines, 2 calls | Small repoint |
| `/sales` form + **edit UI** (#8) | new route + adapted form | Includes fixing #7 properly |
| Redirects from `/beverages/new-sale`, `/bakery/new-sale` | small | |
| **Then Migration B** | 1 migration | Irreversible; SQL already generated and verified clean |
| **Then re-verify everything in a browser** | — | Sales, reports, receipts, CSV, guards, stock, discounts |

**~4,500 lines of code sit in the affected files.** Not all changes, but all needs reading and
re-verifying.

#### Honest effort and risk

- **Effort:** several focused sessions — realistically 4–6 gated steps of the size we've been
  working in, plus a full browser re-verification pass. Not a day's work.
- **Risk concentration:** the changes land in exactly the code that must not break — discount
  stacking, price snapshots, stock reconciliation, and the money figures on reports and receipts.
  Every past bug in this project came from that area, and every one was found in a browser rather
  than a build.
- **Irreversibility:** B destroys the only reconciliation source. Once it runs, a mistake in the
  apportionment arithmetic can't be checked against the old tables.

#### What it actually buys

1. **Mixed-category bills.** A customer buying Pepsi and buns on one visit is currently two separate
   sales. The unified model makes it one bill with one discount and one receipt.
2. **Line-level module attribution that survives a product moving category** — `SaleItem.moduleKey`
   is a snapshot, so re-categorising a product later can't silently re-attribute closed months.

Both are genuine improvements. Neither is something the app currently gets *wrong* — they're
capabilities it doesn't have.

#### My recommendation: **don't build it before handoff.**

The reasoning, stated plainly so you can disagree with it:

- The app **works today**. Per-module sales, discounts, stock, receipts and reports are all shipped
  and verified.
- The three real blockers are **billing and data entry**, not code. Handoff is not waiting on this.
- The rework's risk sits precisely in the money paths, and the payoff is a convenience the owner has
  never asked for — nobody has reported "I can't put buns and Pepsi on one bill."
- Doing it *after* handoff is strictly safer: real usage will show whether mixed bills matter, and
  by then there'd be real data to validate the apportionment against.

**If you accept that, the tidy close is to abandon the unification rather than leave it half-done:**
drop the dormant `Sale`/`SaleItem` tables, delete the `moduleKey`/`netLineTotal` scaffolding, and
rewrite the CLAUDE.md section to say the per-module tables are the model — full stop. That is
**one small migration and one doc update**, it closes the old/new ambiguity permanently, and it
removes the trap that has now misled seven session briefs. Migration A stays in history as a record.

**If you'd rather keep the option open**, the second-best outcome is to leave the tables dormant and
change nothing — but then CLAUDE.md's "re-check before believing otherwise" section has to stay
prominent, because it is the only thing standing between a fresh session and a destructive mistake.

**What I'd sequence, if it were mine:**

1. Fix **#7** (10 lines, zero regression risk, closes a real landmine before #8 ever exists)
2. **Frontend elevation** — additive, visible, and the prompt is drafted
3. **#10–13** polish: touch targets, PWA, date locale, on-device check
4. **Decide** unification: abandon (small migration) or defer
5. **Go-live**: #2 data reset, #2b shop details, #3 Pro + backups, #14 region — one sitting with the owner

---

## Housekeeping

- **Committed and pushed:** `dda6ab7`. Tree is clean apart from the 58 pre-existing `docs/`
  deletions noted above.
- **No `ZZ_TEST_` data created.** Database unchanged: 27 products, `Saif`, 1 bakery sale, 1 milk
  sale, 1 owner account.
- **Nothing started** on the frontend pass or any rework, as instructed.
