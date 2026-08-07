# Response — Phase 4b: customers hub + receivables

**Date:** 7 Aug 2026
**Task:** build the customers hub and the receivables calculation, verify the math against
real rows, then stop.
**Outcome:** built and **verified in the browser**. One real bug found during verification and
fixed (§3). **Not committed** — awaiting your review. DB restored to exact baseline.

---

## 1. Pre-flight

### Supabase MCP — columns confirmed (read-only)

| `Customer` | `CustomerPayment` | `MilkSale` |
|---|---|---|
| `id`, `name`, `phone?`, `type` | `id`, `customerId` | `id`, `customerId` |
| `isActive` (default true) | `paymentDate` (default now) | `saleDate` |
| `createdAt` | **`amount` numeric(10,2)** | **`totalAmount` numeric(10,2)** |
| | `method?`, `notes?`, `createdAt` | `liters`, `ratePerLiter`, `notes?` |

All three exist; no migration run.

### Context7 — two Prisma behaviours that shaped the design

Pulled the v6 aggregation docs before writing. Two facts matter more than the syntax:

1. **`_sum` returns `null`, not `0`,** when no rows match.
2. **`groupBy` omits a group entirely** when it has no rows.

Both mean a customer with no sales would come back as `null`/absent rather than zero. That is
exactly the "0 sales and 0 payments shows 0, not an error" case in your test list, so it is
handled deliberately: every requested id is **seeded with zero before** the groups are merged
in, and every `_sum` goes through a `?? 0` coalesce.

---

## 2. The receivables rule — one implementation

`lib/receivables.ts`, the same way `reconcileSaleLines` owns the price snapshot:

```
totalBilled = SUM(BeverageSale) + SUM(BakerySale) + SUM(MilkSale)
totalPaid   = SUM(CustomerPayment)
outstanding = totalBilled − totalPaid
```

- **MilkSale is counted now.** Its UI is Phase 5, but a customer may already have milk sales,
  and a balance that silently omits a revenue stream is wrong in the direction that loses the
  owner money. Empty table contributes exactly 0.
- **Aggregated, not iterated.** The list path is a **fixed four queries** regardless of
  customer count — no N+1.
- **All money math on `Prisma.Decimal`**, serialized to numbers once at the route boundary.
  Nothing in the browser derives a balance.

### The sign convention, decided

| Outstanding | Reads as | Colour |
|---|---|---|
| `> 0` | **"Owes"** | rose |
| `= 0` | **"Settled"** | zinc |
| `< 0` | **"In credit"** | emerald |

A negative balance shows its **magnitude** with the word "credit" rather than a minus sign —
"−Rs. 500" under a heading called *Outstanding* reads like a bug; "Rs. 500 · In credit" reads
like what it is.

---

## 3. FAILURE FOUND DURING VERIFICATION — fixed

**The customer profile 500'd on first load.** Reporting it because it is exactly the class of
bug a green build hides, and it would have hit production identically.

```
[api:customers.[id].GET] PrismaClientKnownRequestError:
Invalid `prisma.customerPayment.findMany()` invocation:
Timed out fetching a new connection from the connection pool.
(Current connection pool timeout: 10, connection limit: 1)
```

**Root cause.** The profile route fanned out a `Promise.all` of six operations, two of which
were themselves `Promise.all`s of four queries — **12 concurrent queries**. But the pooled
Supabase URL runs `connection_limit=1` (mandated in CLAUDE.md's env contract, and the same on
Vercel). So eleven of them queued for one connection and the ones at the back blew the 10s
pool timeout. `tsc` and `next lint` were both clean throughout.

**Two things were wrong, and both are fixed:**

1. **Concurrency was a liability, not a win.** With one connection there was never any
   parallelism to gain. Every fan-out in `lib/receivables.ts` is now `await`ed in series —
   same total time, no pool contention, cannot time out waiting for itself.
2. **Rows were being fetched twice** — once for the ledger, once for the purchases list.
   `getCustomerActivity()` now fetches them **once** and both the timeline and the purchases
   are built from that. The profile went from **12 queries to 5**.

This is documented at length in the source so a future session doesn't reintroduce it.

---

## 4. The math, verified against real rows

Not a build — actual API calls against actual database rows.

### Cross-module billing

| Step | Expected | Actual |
|---|---|---|
| Beverage sale (10 × 120) | 1200 | **1200** |
| Bakery sale (3 × 250 + 12 × 40) | 1230 | **1230** |
| `totalBilled` across both modules | 2430 | **2430** ✅ |

### The payment lifecycle — every case from your list

| # | Case | Result |
|---|---|---|
| 1 | **Partial payment** of 1000 | 2430 → **1430**, dropped by **exactly 1000** ✅ |
| 2 | **Settle exactly** (pay the remaining 1430) | outstanding **exactly 0**; billed 2430 = paid 2430 ✅ |
| 3 | **Overpay** by 500 | outstanding **−500**, renders as **"Rs. 500 · In credit"** ✅ |
| 4 | **Delete that payment** | back **up by exactly 500**, returns to 0 ✅ |
| 5 | **Customer with 0 sales, 0 payments** | `{billed: 0, paid: 0, outstanding: 0}` — **zero, not null or an error** ✅ |

### Three independent paths agree exactly

The strongest check available, and it passes:

```json
{ "aggregatePath": { "totalBilled": 3330, "totalPaid": 2430, "outstanding": 900 },
  "rowPath":       { "totalBilled": 3330, "totalPaid": 2430, "outstanding": 900 },
  "pathsAgree": true,
  "ledgerFinalBalance": 900,
  "ledgerAgreesWithOutstanding": true }
```

- **Aggregate path** — `/balance`, four DB aggregates, no rows loaded.
- **Row path** — the profile, summarised from loaded rows.
- **Ledger** — the running balance after the last timeline entry.

All three land on 900. They are computed differently on purpose (a list must not load rows; a
profile has them already), so their agreement is a real test rather than a tautology.

### The running-balance timeline, on screen

```
Beverages sale  05/08/2026  1 item    +Rs. 1,200    Rs. 1,200
Bakery sale     06/08/2026  2 items   +Rs. 1,230    Rs. 2,430
Payment · cash  07/08/2026            −Rs. 1,000    Rs. 1,430
Payment ·transfer 07/08/2026          −Rs. 1,430    Rs. 0
Bakery sale     07/08/2026  1 item    +Rs. 900      Rs. 900
```

Sales `+` in module colours, payments `−` in emerald, balance rose when owed and zinc at zero.
Oldest-first deliberately — a running balance only reads correctly downwards.

### The hub

Total outstanding **Rs. 1,200** = 900 + 300, "2 customers owing", sorted **biggest debtor
first**, rose applied.

One decision worth flagging: the summary **excludes customers in credit** from the total
rather than netting them off. Letting one customer's Rs. 500 credit cancel another's Rs. 500
debt would report "Rs. 0 outstanding" while someone still owes Rs. 500. Credit is shown in its
own tile.

---

## 5. Files

### New

| File | What |
|---|---|
| `lib/receivables.ts` | **The calculation.** Balances (single + bulk), activity fetch, ledger |
| `lib/receivables-display.ts` | Tone/label/colour rules, shared by hub and profile |
| `app/api/customers/[id]/route.ts` | GET profile + ledger, PATCH, DELETE (soft) |
| `app/api/customers/[id]/payments/route.ts` | GET list, POST |
| `app/api/customers/[id]/payments/[paymentId]/route.ts` | PATCH, DELETE |
| `app/api/customers/[id]/balance/route.ts` | GET the balance alone |
| `app/(dashboard)/customers/page.tsx` · `[id]/page.tsx` | The two screens |
| `components/customers/CustomersHub.tsx` | Summary bar, search, sorted list |
| `components/customers/CustomerProfile.tsx` | Stats + Purchases/Payments/Balance tabs |
| `components/customers/CustomerDialog.tsx` · `PaymentDialog.tsx` | Add/edit dialogs |

### Modified

| File | Change |
|---|---|
| `app/api/customers/route.ts` | Extended (not rebuilt) — GET now carries balances; `withBalances=false` for the sale picker |
| `lib/hooks/use-customers.ts` | Extended with profile/payment hooks |
| `lib/validations/customers.ts` | Added customer update + payment schemas |

**Reused, not rebuilt:** `CustomerCombobox` and the sale form's inline add-customer popover are
untouched; `SaleDatePicker` is reused by the payment dialog; the beverages/bakery sale flows
were not modified.

### Two design notes

- **A payment must be `> 0`.** A zero payment is noise; a negative one would act as a manual
  debt increase — a sale with no line items and no audit trail. Overpayment is still
  expressible, as a negative balance.
- **Payment lookups are scoped by `customerId`, not id alone**, so a payment id from another
  customer's ledger can't be edited or deleted through this customer's URL.

---

## 6. Manual test list

Sign in first. The receivables cases are the point; the rest is the surrounding UI.

### 6.1 The math (the part that matters)

| # | Step | Expect |
|---|---|---|
| 1 | Create a customer, record a **beverages** sale and a **bakery** sale for them | Profile "Total billed" = the two totals added |
| 2 | Check `/api/customers/[id]/balance` against the profile | Identical `totalBilled`, `totalPaid`, `outstanding` |
| 3 | Record a **partial** payment | Outstanding drops by **exactly** that amount; "Total paid" rises by it |
| 4 | Record a payment for **exactly** the remainder | Outstanding is **exactly Rs. 0**, label reads **"Settled"**, zinc |
| 5 | Record **another** payment on top | Outstanding negative → shows magnitude + **"In credit"**, emerald |
| 6 | **Delete** that last payment | Outstanding goes back **up by exactly** that amount |
| 7 | Create a customer with **no sales and no payments** | Rs. 0, "Settled" — **not** an error, not blank |
| 8 | Open the **Balance** tab | Running balance column matches the sales/payments above it, ending at the outstanding |
| 9 | Edit a payment's amount | Outstanding moves by the difference, not the full amount |

### 6.2 The hub

| # | Step | Expect |
|---|---|---|
| 10 | `/customers` with no customers | Empty state + "Add customer" |
| 11 | With several customers | **Biggest debtor first**, not alphabetical |
| 12 | Summary bar | Total = sum of positive balances only; credit shown separately |
| 13 | Search by name / phone | Filters live; clear button restores |
| 14 | Add customer | Toast, appears in list, Rs. 0 |
| 15 | Duplicate name | 409, `A customer named "X" already exists.` |

### 6.3 The profile

| # | Step | Expect |
|---|---|---|
| 16 | Purchases tab | Beverages/bakery/milk merged newest-first, module-coloured dots |
| 17 | Payments tab | Newest first, method + notes shown, edit/delete per row |
| 18 | Record payment dialog | Date defaults to **today (Karachi)**; "Pay full balance" fills the exact outstanding; live "balance after this" preview |
| 19 | Delete payment | Confirm dialog naming the amount and its effect |
| 20 | Edit customer | Name/phone/type update; past sales unchanged |

### 6.4 Shared behaviour

| # | Step | Expect |
|---|---|---|
| 21 | Sign out in another tab, then act | "Your session expired…" then redirect — no `res.json()` crash |
| 22 | Offline, then record a payment | Recovers with "Can't reach the server." — doesn't hang |
| 23 | 360px width | Cards, no horizontal scroll |
| 24 | Reduced motion | Count-up jumps rather than springs |

### 6.5 Regression

| # | Step | Expect |
|---|---|---|
| 25 | Beverages + bakery sale flows | Unchanged — the sale-form customer picker still works |
| 26 | Sale form customer dropdown | Loads fast (it requests `withBalances=false`) |

---

## 7. Verification performed

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx next lint` | ✔ No ESLint warnings or errors |
| Supabase column check (read-only) | all three tables confirmed |
| **Receivables math vs real rows** | **all 5 of your cases pass exactly** (§4) |
| **Three balance paths agree** | **yes — 900 / 900 / 900** |
| Profile / hub / ledger in browser | verified, screenshots taken |
| Migration run? | **No** |
| Committed? | **No** |

**Not yet verified:** §6.4 (session-expiry, offline, 360px, reduced motion) and §6.5
(regression on the sale flows). Those are the same shared behaviours verified in Phases 3.2
and 4, and I did not re-exercise them this pass — say the word and I'll cover them before you
review.

---

## 8. Cleanup — DB at exact baseline

| Table | Baseline | After | Match |
|---|---|---|---|
| `User` | 1 | 1 (`i228767@nu.edu.pk`) | ✅ |
| `Customer` | 0 | 0 | ✅ |
| `CustomerPayment` | 0 | 0 | ✅ |
| `BeverageSale` / items | 0 / 0 | 0 / 0 | ✅ |
| `BakerySale` / items | 0 / 0 | 0 / 0 | ✅ |
| `MilkSale` | 0 | 0 | ✅ |
| `Product` (total / active / priced) | 62 / 62 / 0 | 62 / 62 / 0 | ✅ |
| `Category` / `SubCategory` | 2 / 11 | 2 / 11 | ✅ |

Deleted, `ZZ_TEST_`-scoped only: 4 payments, 2 customers, 2 beverage sales, 3 bakery sales and
their items, 1 throwaway user. Verified **0 non-`ZZ_TEST_` rows** were in range first. Owner
account untouched. Dev server stopped; isolated browser context used throughout.

**Nothing committed.** Ready for your review.
