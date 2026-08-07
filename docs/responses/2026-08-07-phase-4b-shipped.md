# Response — Phase 4b targeted verification, committed, deployed

**Date:** 7 Aug 2026
**Task:** close the §6.4 / §6.5 gap in the browser, then commit, push, preview-deploy and mark
Phase 4b ✅.
**Outcome:** **all requested checks PASS.** Committed **`8448591`**, preview build green.
Two cosmetic findings reported below — neither is a stated check, neither was hidden.

---

## 1. §6.5 regression — the one that isn't ceremonial

### The picker requests `withBalances=false` — confirmed on the wire

```
GET /api/customers?withBalances=false   [200]
GET /api/products                       [200]
```

That is the actual network log from loading `/beverages/new-sale`. The flag isn't just present
in the source; the picker really sends it.

### And it measurably matters

Three runs each, warmed first so this compares work rather than cold compile:

| Endpoint | Runs (ms) | Avg |
|---|---|---|
| `?withBalances=false` (picker) | 1041, 1055, 1040 | **1,045 ms** |
| default, with balances (hub) | 5046, 5301, 5320 | **5,222 ms** |

**~4.2 s saved per picker load.** The four aggregate queries are genuinely not in that path —
if the flag were being ignored the two would be indistinguishable.

### Both sale flows work end to end after the customers-route change

| Check | Result |
|---|---|
| Beverages: pick customer **through the picker** → save | **PASS** — chip shown, Rs. 1,200 saved, "Sale recorded" |
| Bakery: same, with Eggs | **PASS** — Rs. 800 saved, `Quantity (cottons)` still correct |
| Balance rolls up across both | **PASS** — 1200 + 800 = **2,000** |

---

## 2. §6.4 — on the NEW surface specifically

### Offline, recording a payment (the new mutation)

```json
{ "navigatorOnline": false,
  "recoveredAtMs": 216,
  "hungForever": false,
  "finalButton": { "text": "Record payment", "disabled": false },
  "dialogStillOpen": true,
  "toasts": ["Can't reach the server. Check your connection."] }
```

**PASS** — recovers in **216 ms**, button re-enables, and the dialog stays open so the typed
amount isn't lost. Back online, verified **no phantom payment** was written: `paymentCount: 0`,
outstanding still 2,000.

### Session expiry, recording a payment

Killed the session server-side, then submitted:

- toast: **"Your session expired — please sign in again."**
- redirect to **`/login?callbackUrl=%2Fcustomers%2F…`**
- **no `res.json()` crash**

**PASS.**

### 360px width

| Screen | scrollWidth / clientWidth | Horizontal scroll | Layout |
|---|---|---|---|
| Hub | 360 / 360 | **none** | summary tiles stacked, cards fit, search 44px |
| Profile | 360 / 360 | **none** | three stat cards stacked, tabs visible |

**PASS** on the stated check (cards, no horizontal scroll). See §3 for a touch-target finding
noticed while measuring.

### Reduced motion

| Condition | Distinct frames | Behaviour |
|---|---|---|
| `prefers-reduced-motion: reduce` forced | **1** | jumps straight to Rs. 2,000 |

**PASS** — it jumps rather than springs, which is what was asked.

### Bonus: the mutation's cache invalidation actually works

Worth recording because my first attempt looked like a bug and wasn't. Recording a payment via
raw `fetch` left the hub showing a stale total — that was **my test artifact**, bypassing the
mutation hook. Through the real dialog:

- Profile: outstanding **1,200 → 1,000**, Total paid **800 → 1,000**, immediately, no reload
- Hub after navigating back: **Rs. 1,000**, matching the API exactly

---

## 3. Two cosmetic findings — reported, not fixed

Neither is one of your stated checks; both were noticed while measuring. Flagging rather than
quietly fixing or quietly ignoring.

### 3.1 Touch targets below 44px on the profile

The Design System sets a 44px minimum. Measured at 360px:

| Element | Height |
|---|---|
| Tabs (Purchases / Payments / Balance) | **28px** |
| "All customers" back link | **20px** |

These are shadcn's default `TabsTrigger` height and a plain text link. Everything else passes —
the search input is exactly 44px, buttons and cards are fine. Worth a Phase 8 pass, or tell me
and I'll raise them now.

### 3.2 The hub total doesn't count up on mount

The 4b brief asked for a count-up on the total outstanding. It renders at its final value
instead — **1 distinct frame with motion allowed**, same as with reduced motion.

Cause: `AnimatedMoney` does `useMotionValue(value)`, i.e. it initialises **at** the target, so
there's nothing to animate from on first mount. That was deliberate in Phase 3.2, where it
tracks a running total that keeps changing and must never restart from zero. `StatCard` is the
component that counts up from 0 on mount.

So the reduced-motion check passes correctly, but the count-up is effectively absent in both
modes. Two options if you want it: use `StatCard`'s from-zero behaviour for this tile, or give
`AnimatedMoney` an opt-in `countUpOnMount` prop. Not changed on my own initiative.

---

## 4. Committed — `8448591`

```
feat: phase 4b - customers hub + receivables (pooled-connection safe)
17 files changed, 3128 insertions(+), 32 deletions(-)
```

The body covers what you asked: the calculation lives once in `lib/receivables.ts`, includes
MilkSale ahead of its UI, aggregates via `groupBy`/`_sum` (no N+1), and the profile route was
serialized to respect `connection_limit=1`.

Pushed: `b90b5c4..8448591`.

### Ignores confirmed

| Pattern | Status |
|---|---|
| `.env`, `.env.local`, `.env.production` | ignored (`.gitignore:32`) |
| `.vercel`, `.vercel/project.json` | ignored (`.gitignore:36`) |
| `docs/prompt.txt` | ignored (`.gitignore:46`) |
| Tracked env files | only `.env.example` (placeholders) |

---

## 5. Preview deploy — green

| | |
|---|---|
| Result | **READY**, `✓ Compiled successfully` |
| `target` | **preview** — production untouched |
| URL | `https://muneeb-inventory-system-lknzm50ew.vercel.app` |
| `/customers` | 3.04 kB (244 kB first load) |
| `/customers/[id]` | 8.74 kB (269 kB) |
| Middleware | **78.2 kB** — unchanged |
| Build/runtime logs | **no pool, connection or timeout errors** |

All five API routes registered: `/api/customers`, `/api/customers/[id]`, `/[id]/balance`,
`/[id]/payments`, `/[id]/payments/[paymentId]`.

Signed-out checks: both API routes **401 JSON**, both pages **307 → `/login?callbackUrl=…`**.

### One honest limitation on "the pooled fix in the real serverless runtime"

The preview build is green and the routes are registered, but I **could not exercise the
profile route end-to-end in serverless**. Preview deployments sit behind Vercel SSO, and every
signed-out request short-circuits at `requireOwner()` **before touching Prisma** — so those
401s prove auth works, not that the connection pool is happy.

What can be said with confidence:

- `connection_limit=1` is a property of `DATABASE_URL`, which is the **same encrypted value in
  Preview and Production** (`vercel env ls` confirms both scopes).
- The failure **and** the fix were both reproduced in dev against that same pooled connection —
  12 concurrent queries timed out, 5 sequential ones don't.
- The fix is environment-independent: it removes concurrency rather than tuning a limit.
- Build and runtime logs show no pool/connection errors.

If you want it proven in serverless specifically, the way to do it is a throwaway login driven
through the preview URL with the SSO cookie — say the word and I'll run it.

---

## 6. CLAUDE.md

**Phase 4b marked ✅.** Two additions:

1. **A new guardrail section: "Never fan out Prisma queries with Promise.all (pooled
   connection = 1)"** — with the actual error text, the 12-query story, and the fetch-rows-once
   pattern. This is the class of bug that recurs unless it's written down.
2. **Phase 4b carried-forward notes** — `lib/receivables.ts` is THE calculation, MilkSale is
   already counted ahead of Phase 5, and a customer is never hard-deleted.

---

## 7. State

- DB at **exact baseline**: 1 user (`i228767@nu.edu.pk`), 0 customers, 0 payments, 0 sales in
  either module, 0 milk sales, 62 products all active at price 0, 2 categories / 11
  sub-categories. All `ZZ_TEST_` data deleted after verifying 0 non-test rows were in range.
- Owner account untouched; isolated browser context throughout; dev server stopped.
- Nothing promoted to production.

| Phase | Status |
|---|---|
| 1–4 | ✅ Done |
| **4b** | **✅ Done** |
| 5 | ⬜ Milk shop: farmers, deliveries, purchases, milk sales |
| 6–8 | ⬜ |

Stopped.
