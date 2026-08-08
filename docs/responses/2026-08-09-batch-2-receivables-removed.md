# Batch 2 — receivables removed, sales are revenue-only

**Date:** 2026-08-09
**Commit:** `7b1ce6a` — *refactor: remove receivables UI, sales are revenue-only (tables kept, reversible)* (pushed to `main`)
**Constraints honoured:** no migration, no schema change, customer still attached to every sale, `CustomerPayment` and `lib/receivables.ts` left intact and dormant, farmer side untouched.

---

## TL;DR

| # | Item | Status |
|---|---|---|
| 1 | Customers section — remove balances + payments | ✅ Hub is a directory, profile keeps purchases only |
| 2 | Reports — drop receivables tile + its slow queries | ✅ **6,235ms → 2,121ms** on `/api/reports/balances` |
| 3 | Milk sales revenue-only | ✅ Confirmed — no code change needed beyond the UI removal |
| 4 | Farmer side untouched | ✅ `lib/milk.ts` not modified; hub + balance sheet verified identical |
| 5 | Fix `/` fake zeros | ✅ Shows today's real revenue |

**Biggest result: the speed win was larger than expected**, because the same four
receivables queries were slowing down *two* screens, not one. Details in §2.

---

## 0. Context7 — still not connecting (third session)

Tried again first, as instructed. The `context7` MCP server sat in "connecting" and repeated
tool searches returned nothing. Fell back to the installed packages as before, which for this
batch meant confirming shadcn primitives and the Recharts/TanStack surfaces already in use
rather than pulling docs.

**Flagging as asked:** CLAUDE.md's rule — *"Always use Context7 MCP before writing code for
Next.js, Prisma, shadcn, NextAuth, or Supabase. Never rely on training data"* — has now been
unmet three sessions running. The rule's *intent* has still been honoured every time, by
reading `node_modules` (the installed source is strictly more authoritative than docs for
"what does this version actually do" — it is how batch 1 found the Recharts animation gate).
Suggested amendment when you next touch CLAUDE.md: keep Context7 as the default, and name the
installed-package fallback as explicitly acceptable when the server is unavailable, so the
rule describes what actually happens rather than being routinely violated.

---

## 1. Customers — from debtors list to directory

### Hub (`/customers`)

Gone: the "Total outstanding" headline, the "In credit" tile, and the per-row owed column.

Three consequential changes came with it, each deliberate:

- **Sorted alphabetically.** It used to sort biggest debtor first, which was correct for a
  ledger and is meaningless for a contact list.
- **`withBalances: false`.** Not tidiness — this is what takes the request from five queries
  to one (see §2).
- **Active only.** The `includeInactive: true` flag existed *specifically* so retired
  customers' unpaid balances still counted toward the total. There is no total and no balance,
  so the flag had no remaining purpose.

The row now shows name, customer type and phone. The count line above the list counts what is
**on screen**, not what was fetched, so it never reads "12 customers" above 3 search results.

### Profile (`/customers/[id]`)

Removed: Total billed / Total paid / Outstanding tiles, the Payments tab, "Record payment",
and the running-balance ledger.

**Kept: the Purchases history** — the reason to open a customer at all, and explicitly the
thing you wanted preserved. Verified against Saif's real record: both his purchases still
render, including the milk sale.

The tab bar went too, since one tab is a heading rather than a tab bar. Minor bonus: that
removes two shadcn `TabsTrigger`s, which are on the Phase 8 list for being 28px against the
44px minimum. The "All customers" back link (also on that list at 20px) got `min-h-[44px]`
while I was in the file.

### Server side

`/api/customers/[id]` no longer computes or returns `balance`, `payments` or `ledger`. The
`DELETE` handler no longer fetches a balance either — it existed to warn "deactivated, but
still owes Rs. X", a sentence that can no longer be true.

### What was deliberately kept dormant

| Kept | Why |
|---|---|
| `CustomerPayment` table | Explicitly required. No migration was run. |
| `lib/receivables.ts` | Whole file intact, including `getTotalOutstanding`, `summariseActivity`, `buildLedger`. `getCustomerActivity` is still called — it is the shared single fetch. |
| `PaymentDialog.tsx` | Marked `⚠️ DORMANT` in its header with a pointer to what to re-mount. |
| Payment mutations in `use-customers.ts` | Untouched. |
| `Payment` / `CustomerBalance` / `LedgerEntry` types | Kept on purpose — deleting them would make restoring receivables a rewrite rather than a re-wire. |
| `customer_balances` case in the export route | Left in place, no longer reachable from the UI. |

---

## 2. Speed — the four queries were slowing down *two* screens

Measured against the live database, warm, before and after:

| Endpoint | Queries before | Before | Queries after | After |
|---|---|---|---|---|
| `/api/reports/balances` | 6 | **6,235 ms** | 2 | **2,121 ms** |
| `/api/customers` (hub) | 5 | **5,637 ms** | 1 | **1,068 ms** |

Both drops are the *same* four queries: `getTotalOutstanding()` on the dashboard and
`getCustomerBalances()` on the hub are two callers of the same receivables aggregation
(beverage + bakery + milk + payments, grouped by customer).

The 6,235 → 2,121 ms figure lines up exactly with the documented model — six round trips at
~1.04s each, dropping to two. The remaining two are the farmer aggregates, which stay.

**Dashboard first visit** now issues 8 database queries instead of 12 (summary 1 + balances 2
+ trend 3 + top-products 2), and the balances tile — which was always the last thing to
finish — arrives roughly 4 seconds sooner.

Worth being clear about what this is *not*: the ~1.05s-per-query floor is unchanged. This
batch removed queries; it did not make any query faster. That is still the handoff
region-co-location fix (`iad1` → `icn1`).

---

## 3. Milk sales

Confirmed revenue-only with **no code change needed** beyond the receivables removal, exactly
as you predicted. Verified: a milk sale still records, still carries its customer, still shows
on that customer's purchase history (Saif's `Milk 08/08/2026 · 50 L × 120 · Rs. 6,000`), and
still counts toward reports revenue.

Two pieces of *wording* did need fixing, because they asserted something no longer true:

- `MilkSaleDialog` told the owner **"This adds to what the customer owes you."** → now
  "Recorded as revenue against this customer."
- `MilkSalesList`'s header comment claimed every sale lands in the customer's receivable.

---

## 4. Farmers — untouched, and verified so

`lib/milk.ts` was not modified. Verified in the browser after all the changes:

| Screen | Reads |
|---|---|
| `/milk` | You owe farmers **Rs. 5,000**, milk bought 250 L, 1 active farmer |
| `/milk/balances` | Rs. 5,000 owed · Rs. 30,000 milk · Rs. 25,000 purchases · farmers-ahead split intact |

The **"Owed to farmers" tile stays on the dashboard**, and the reasoning is worth recording:
the owner genuinely does owe farmers for milk already delivered. That is a *payable*, and a
real obligation. A customer receivable was a debt the owner chose to stop tracking. The two
look symmetric and are not — which is also why the sign convention in `lib/milk-display.ts`
was never something to reuse on the customer side.

---

## 5. The `/` home page

It was still the Phase 1 placeholder: three `value={0}` cards and a comment promising real
aggregates in Phase 7. Phase 7 built them on `/reports` and nobody came back. **So the first
screen the owner saw after signing in confidently reported that they had sold nothing — for
six phases.**

**Chose real data over redirecting to `/reports`.** A redirect was cheaper, but "Dashboard"
and "Reports" are two separate items in the sidebar and bottom nav, and having both land on
the same screen is a different kind of lie. They now answer different questions: this one is
*"what has happened today"*, `/reports` is *"how is the business doing over a period"*.

It costs **one** query — the existing `/api/reports/summary?period=today` — and deliberately
fetches no balances, trends or top products, because a landing screen has to paint fast. It
shares a cache entry with the "Today" tab on `/reports`, so opening that afterwards is free.

**One distinction worth stating**, since the screenshot still shows zeros: a `Rs. 0` here is
now *earned*. Today (09/08) genuinely had no sales when the page first loaded, and the page
says **"No sales recorded today yet."** underneath rather than leaving a bare figure ambiguous
between "nothing sold" and "something is broken". The problem was never the digit — it was
that it was a constant. Proved by recording a sale: the page moved to **Rs. 840 · "1 sale"**
with no reload.

Loading shows skeletons, not zeros — `StatCard` counts up from 0 on mount, so rendering it
with a placeholder would animate a real-looking number to a value nobody knows yet.

---

## Verification

All in the browser, against the running app.

| Check | Result |
|---|---|
| Sale records as revenue with a customer attached | ✅ Rs. 840 to `ZZ_TEST_Batch2 Shop`, dated today |
| `/` reflects it live | ✅ 0 → **Rs. 840**, "1 sale", no reload (`window` marker survived) |
| Customer history preserved | ✅ Saif's bakery **and** milk purchases both render |
| No owed/outstanding on the customer side | ✅ Asserted by regex over the rendered text of both `/customers` and `/customers/[id]` — `false` on `outstanding\|owed\|owes\|total billed\|total paid\|record payment\|balance` |
| Reports: receivables tile gone, farmer tile stays | ✅ `hasReceivablesTile: false`, `hasFarmerTile: true` |
| Reports: no "Customer balances" export | ✅ `hasCustomerBalancesExport: false`, farmer export still present |
| Dashboard first visit faster | ✅ balances 6,235 → 2,121 ms (6 → 2 queries) |
| Farmers unchanged | ✅ hub and balance sheet both Rs. 5,000, all splits intact |
| `tsc --noEmit` / `next lint` | clean |
| Production build | ✅ green |
| Edge bundle guardrail | ✅ 0 matches for prisma/bcryptjs on a 240 KB **production** artifact |
| Test data cleanup | ✅ 0 `ZZ_TEST` leftovers; Saif's records match baseline |

I checked the "no owed anywhere" requirement by matching the rendered page text rather than
reading the screen, because that catches copy buried in a dialog or a tooltip that a
screenshot would not — which is how the `MilkSaleDialog` wording in §3 turned up.

### A note on the build

`npm run build` first failed with `EPERM ... query_engine-windows.dll.node` — the running dev
server holds the Prisma engine locked on Windows. Not a code fault. I stopped the dev server,
built clean, ran the edge-bundle check against the real production artifact (a rare chance —
CLAUDE.md notes that check gives false positives against a dev bundle), then restarted exactly
one dev server on port 3000.

---

## Judgement calls you may want to overrule

1. **Removed the "Customer balances" CSV export button.** Its columns are Total billed / Total
   paid / Outstanding — precisely the figures the app stopped tracking. Leaving the button
   would hand the owner a spreadsheet the screens contradict. The route case is dormant, so
   restoring it is deleting a comment.

2. **No "lifetime spend" figure on the profile.** You listed "Total billed" for removal, and
   total-purchased is the same number wearing a different hat, so I did not reintroduce it. It
   is *not* an owed figure though, and it is genuinely useful — say the word and it goes back
   as "Total purchased".

3. **The profile still fetches payments it does not use.** `getCustomerActivity()` pulls
   beverage + bakery + milk + payments in one shared fetch. I kept calling it unchanged rather
   than forking a purchases-only variant, because it is documented as THE single fetch and
   touching it risks the 12-query timeout it was written to fix. Cost: one wasted query
   (~1s) on profile open. Cheap price for keeping `lib/receivables.ts` genuinely untouched and
   the restore path trivial — but it is a real cost, so it is on the record.

4. **The customers hub lost "last activity"** on each row. That date came from the balance
   aggregation, so keeping it would mean keeping all five queries. Directory speed won.

---

## What did NOT change

- Any table, column, or migration. `CustomerPayment` still exists with its rows (0, as before).
- `lib/receivables.ts`, `lib/milk.ts`, `lib/milk-display.ts`.
- The sale flow, the price-snapshot rules, `reconcileSaleLines`.
- Every sale still stores its `customerId`.

**Stopping here as instructed — stock is batch 3.**
