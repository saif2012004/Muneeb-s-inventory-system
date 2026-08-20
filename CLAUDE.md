# CLAUDE.md - Business Management App
# Pepsi Agency · Bakery · Milk Shop

> Place this file at the ROOT of the project repo.
> Claude Code reads it automatically at the start of every session.
> Keep it updated as the schema or business rules evolve.

---

## 📦 STATUS: the BUILD is complete. The HANDOVER is not.

**Every development phase (1–8) and every stage of the unified-sale rework (S1–S9) has shipped,
been verified, and is live in production.** There is no feature work outstanding and no migration
pending.

**Three things still stand between this and the owner running his shop on it**, and none of them
is code:

| | What | Whose job |
|---|---|---|
| ✅ | ~~The data reset~~ — **DONE 2026-08-19.** All transactional history cleared; catalog, settings and login kept | closed — CHECKLIST #2 |
| 🔴 | **Vercel Pro + Supabase Pro** — Hobby FORBIDS commercial use and the free Supabase tier keeps ZERO backups | A billing action at handover — CHECKLIST #3 |
| 🟡 | **Prices and shelf counts** — 73 of 75 products sit at Rs. 0 and stock is still the seed placeholder | His, at handover |
| 🟡 | **`prod_milk.stock` reads 4,050 L against an EMPTY delivery ledger** — see the milk-stock note | His to set, at handover |

**Do not read "build complete" as "ready to hand over".** The full, current picture is in
`REMAINING-WORK.md`.

> **📁 The `docs/` folder was removed on 2026-08-19, deliberately.** It held 112 phase reports and
> dated response files — a build diary that had served its purpose. **Every one of them is still in
> git history** (they were committed immediately before deletion), so `git log -- docs/` recovers
> anything you need. Nothing in this file or in the source depends on them any more: every claim
> that used to end in "evidence: docs/…" now stands on its own, and the pointers were stripped
> rather than left dangling — a reference to a file that no longer exists is exactly the kind of
> confident, specific, wrong instruction the process rule below exists to prevent.

---

## 🔁 PROCESS RULE: updating this file is PART OF the change, not a follow-up

**If a change alters a rule documented here, the CLAUDE.md edit ships in the SAME commit as the
code. Not "next session", not a docs pass at the end of the phase.**

This is not a tidiness preference. **A cold session trusts this file completely** — it is read
before any code, and it is the only thing a new session has before it starts making decisions. A
stale line here is worse than no line: it is a confident, specific instruction to do the wrong
thing, and it gets followed.

It has already drifted three times, each caught by accident rather than by process:

| Drift | What the file said | What was true |
|---|---|---|
| Context7 | "DOWN since 3 Aug, 6+ sessions" | Reconnected — and can be pinned to the v6 branch |
| Discount variants | "separate Product records with the discounted price" | Deleted 2026-08-09; discount is a sale-time % |
| Stock | listed under **Out of scope**, "no stock table" | Shipped 2026-08-09, with delta reconciliation |
| Unified tables | "NOTHING reads or writes Sale/SaleItem" | POST /api/sales went live 2026-08-13 (S3); grep now returns matches |

All three were fixed on 2026-08-10, and the snapshot rule was hardened with the stable-line-id
guardrail in the same pass.

**The check before you finish a task:** did I change behaviour that this file describes? If yes,
the file is part of the diff. If you are unsure whether a rule is still true, **verify it against
the code before repeating it** — including the rules in this file.

**Open work is tracked in ONE place: the `✅ PRE-HANDOFF CHECKLIST` near the end of this file.**
Three of its items block go-live (#1 closed 2026-08-10). Do not record an open item anywhere else —
a task written into a prose section is a task that gets lost, which is exactly how the checklist
came to be needed.

**The one sanctioned exception:** two go-live blockers (the login POST-only fix and the data reset)
are *deliberately* mirrored as one-line stubs in the Development Phases table, because that table is
where someone looks when they think they are done. The stubs are labelled as intentional; the
checklist remains authoritative and is the copy you update. That is the only duplication in this
file — do not add a third.

## Project Overview

A full-stack business management web app for a single owner who runs three business units:

1. **Beverages** - Pepsi agency selling multiple beverage brands
2. **Bakery** - Cake rusk, buns, biscuits, russ, eggs
3. **Milk Shop** - Farmers deliver milk (owner buys); owner also sells milk to hotels/shops

Single owner login. No multi-user roles. Mobile-first PWA. Deployed on Vercel. Currency is PKR. Owner is in Pakistan (timezone Asia/Karachi, UTC+5).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS + shadcn/ui |
| Animation | Framer Motion |
| Database | Supabase (PostgreSQL) |
| ORM | Prisma |
| Auth | NextAuth.js v5 / Auth.js (credentials provider) |
| Data fetching | TanStack Query (React Query) |
| Forms | react-hook-form + zod |
| Charts | Recharts |
| Deployment | Vercel |
| MCP Tools | Supabase MCP + Context7 MCP (always keep active) |

**Always use Context7 MCP before writing code for Next.js, Prisma, shadcn, NextAuth, or Supabase. Never rely on training data for these APIs, they change often.**

**If Context7 will not connect, fall back to the INSTALLED PACKAGE SOURCE in `node_modules` —
never to training data.** This is the sanctioned fallback, not a shortcut, and it has been the
actual practice since 3 Aug 2026 (see the Phase 8 Context7 item in the carried-forward notes).
Read the installed `.d.ts`, the package's own source, or execute the API in a scratch script.
For "what does this version actually do", that is *stronger* than docs: it is the code that will
run, at the version that is pinned. Three real bugs were found that way — the Recharts entrance
animation freezing at 5% (`node_modules/recharts/es6/cartesian/Line.js`), `Prisma.Decimal`'s
`ROUND_HALF_UP` default confirmed by executing it rather than assuming, and the v6-vs-v7 Prisma
split above. **Say in the response which source you used**, so a reviewer knows whether a claim
came from docs, from source, or from a live check.

### Prisma version conventions (guardrail)

**Prisma is pinned to v6.x (`prisma` and `@prisma/client` both `^6`). Do NOT upgrade to v7 without a deliberate, planned migration task.**

npm will resolve `prisma`/`@prisma/client` to 7.x if installed without a version range. If you ever see 7.x in `npm ls prisma @prisma/client`, that is a mistake — reinstall at `^6`.

**Context7 now serves Prisma v7 docs by default. Those do NOT apply to this project.** When you pull Prisma docs, read them for v6 semantics and ignore any v7-only pattern you find. Use v6 conventions only:

| Concern | v6 convention (use this) | v7 pattern (do NOT use) |
|---|---|---|
| Client import | `import { PrismaClient } from "@prisma/client"` | import from a generated output path |
| Generator | `provider = "prisma-client-js"`, **no** `output` field | `provider = "prisma-client"` with required `output` |
| Datasource | `url = env("DATABASE_URL")` (pooled) **plus** `directUrl = env("DIRECT_URL")` | driver adapters replacing `directUrl` |
| Driver adapter | none — do not add one | `@prisma/adapter-*` + `adapter:` in the constructor |
| Config file | none — config lives in `schema.prisma` | `prisma.config.ts` |
| ESM/CJS | default behaviour, no extra config | v7 ESM-first output |

So the datasource block for this project is exactly:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled, pgbouncer
  directUrl = env("DIRECT_URL")     // direct, migrations only
}
```

---

## CRITICAL IMPLEMENTATION GOTCHAS (read before writing any code)

These are the traps that will waste hours if ignored. They are non-negotiable.

### 1. Prisma relations need both sides
Every relation must be declared on both models or `prisma migrate` fails with a "missing opposite relation field" error. The `Product` model MUST include back-relations for both sale-item tables. This is handled in the schema below, do not remove them.

### 2. Prisma Decimal does not serialize to a number
Every money and liter field is a Prisma `Decimal`, which is an object, not a JS number. If you send it through a Route Handler as JSON, or feed it to Recharts or a count-up animation, you get string-concatenation bugs or `[object Object]`.

**Rule:** convert Decimals to numbers at the API boundary before returning JSON. Do all money math server-side. A shared serializer lives in `/lib/serialize.ts` and every route that returns money must use it. Never do `price1 + price2` on raw Decimals in the browser.

### 3. NextAuth v5 middleware runs on the Edge runtime
bcryptjs and the Prisma client cannot run on Edge. Use the split-config pattern:
- `/lib/auth.config.ts` - edge-safe config (providers list shape, pages, callbacks that only read the token). Imported by middleware.
- `/lib/auth.ts` - full Node config that extends auth.config, does the bcrypt compare and Prisma user lookup in the `authorize` function. Imported by server components and route handlers.
- In v5 you get the session with `auth()`, NOT `getServerSession()`. There is no `getServerSession` in v5.
- `export const runtime = "nodejs"` on any route that touches Prisma or bcrypt.
- Middleware protects everything except `/login`, `/api/auth`, and static assets — not a
  `/dashboard` prefix. The app is served at the root, so prefix-gating would leave it open.
  See the Authentication section.
- `trustHost: true` must stay set in auth.config. v5 ignores `NEXTAUTH_URL` for host trust;
  without the flag, production outside Vercel fails with `UntrustedHost` **inside middleware**,
  so every request silently reads as signed out. See the Authentication section.
- **Signed-out requests under `/api/` return 401 JSON, NOT a redirect. This is intended —
  do not "simplify" it back to a bare `return isLoggedIn`.** The `authorized` callback
  returns `NextResponse.json({ data: null, error }, { status: 401 })` for `/api/` paths and
  `false` (→ redirect to `/login`) for page requests. Returning `false` for an API route
  sends a 307 to the HTML login page, and `fetch()` follows that redirect transparently —
  the caller then receives HTML and dies inside `res.json()` with an opaque parse error
  instead of surfacing "your session expired". Added in Phase 2.1; see the Authentication
  section.
- To verify the split actually holds, grep the built Edge bundle — it must contain none of
  `@prisma/client`, `PrismaClient`, `bcryptjs`, `.prisma`:
  `Select-String -Path .next/server/middleware.js -Pattern '@prisma/client|bcryptjs'`
  **Run this against a PRODUCTION build only.** `next dev` leaves an unminified
  `middleware.js` with comments intact, and the guardrail comments in `lib/auth.config.ts`
  and `middleware.ts` literally contain the word "bcryptjs" — so the check reports 2 false
  hits against a dev bundle. Confirm you have the production artifact (a few hundred KB, no
  comments) before trusting either result. Verified clean on the Phase 2.1 build.

### 3b. 🔴 NEVER call `Prisma.sql` (or any Prisma runtime API) at MODULE TOP LEVEL in a file the client graph can reach

**A top-level `const X = Prisma.sql\`…\`` executes wherever the module is bundled — including the
browser, where it throws and kills the page on hydration.**

Found 2026-08-14, and it had shipped: `lib/reports.ts` exports `REPORT_PERIODS` and
`REPORT_PERIOD_LABELS`, which **client components import**. S6 added
`import { NOT_A_MIGRATION_COPY } from "@/lib/unified-sales"` to that same file, so the SQL fragment
was evaluated in the browser bundle and `/reports` died with:

```
Unhandled Runtime Error
sqltag is unable to run in this browser environment
```

**Tree-shaking cannot save you here** — a top-level call with a side effect is retained whenever any
part of the module is. The fix is to make it **lazy**: `export function notAMigrationCopy()` that
returns the `Prisma.sql` when a server path calls it. Nothing runs at import.

**What makes this dangerous is the failure signature: everything green.** `tsc`, `next lint`,
`npm run build` and the entire API test suite all passed — the SERVER render succeeded, and only
hydration threw. It was caught by opening the page. This is the "verify UI in a real browser, not on
a build" rule (Phase 3 carried-forward note) applying to a purely server-side-looking change.

**The deeper smell, unfixed:** `lib/reports.ts` mixes server-only aggregation with constants that
client components read. Splitting the client-safe constants into their own module would make this
class of bug impossible rather than merely avoided. Worth doing if that file is opened again.

### 3c. 🔴 An ENUMERATED payload silently drops every field you forget to add to it

**Three write paths build their request body field by field rather than spreading the form's values.
A control the form gains but the list never learns about is dropped in silence: the request
succeeds, the toast is cheerful, and the value the owner typed is simply gone.**

It has now happened three times, all found on 2026-08-18 by reading rows back out of the database
after using the screen:

| Where | Field dropped | What the owner saw |
|---|---|---|
| `UnifiedSaleForm` create payload | `chilled` (Migration E) | A chilled bill saved at the plain price — feature shipped and unreachable |
| `UnifiedSaleForm` create payload | `unitName` (Migration F) | **A peti of eggs saved as ONE egg at Rs. 7,000, taking 1 off the pool instead of 360** |
| `CatalogManager` edit-product mutate | `coolingCharge`, `units` | "Product updated", nothing changed |

**Nothing automated can see this.** `tsc` is happy because every field is optional; lint is happy;
the API tests are happy because they hand the endpoint a correct body themselves. Only the browser,
plus a look at the stored row, catches it.

Each of the three sites now carries a 🔴 comment saying every control must be listed. **If you add a
field to one of those forms, add it to the payload — and verify by reading the row back, not by the
toast.**

### 3d. 🔴 PERCENT-ENCODE THE DB PASSWORD, or the app fails while your scripts work

**A `$` or `&` in the Supabase password breaks the app and NOTHING ELSE.** Cost real time on
2026-08-19, during the Mumbai move, because every diagnostic pointed the wrong way.

**The symptom is two different errors, neither of which mentions the password:**

```
Can't reach database server at `aws-0-ap-south-1.pooler.supabase.com:5432`
Authentication failed against database server, the provided database
credentials for `postgres` are not valid
```

Meanwhile: `psql` connects fine. `prisma migrate status` connects fine. A standalone
`new PrismaClient({ datasources: { db: { url } } })` script connects fine and benchmarks at 96ms.
Only the Next app fails.

**Why:** the app reads `.env` through dotenv (`@next/env`), which performs **`$VAR` expansion**. A
password containing `$` is silently rewritten before Prisma ever sees it. Scripts that read the file
with their own regex — which is what every diagnostic here did — get the true string and work
perfectly, which is exactly what makes this so misleading.

`&` is the second trap: it is a query-string separator, so a bare `&` can truncate
`?connection_limit=5`.

**The fix**, and `.env.example` has warned about it since Phase 1:

| Char | Encode as | | Char | Encode as |
|---|---|---|---|---|
| `$` | `%24` | | `#` | `%23` |
| `&` | `%26` | | `?` | `%3F` |
| `@` | `%40` | | `/` | `%2F` |
| `%` | `%25` — do this FIRST | | | |

⚠️ **Encode ONLY the password**, between the first `:` after the scheme and the last `@`. Encoding the
whole URL turns `:5432/postgres` into nonsense, and a sloppy regex that swallows the closing quote
gives you `database "postgres%22" does not exist` — both happened while fixing this.

**Diagnosis shortcut for next time:** if `psql` and a standalone script both connect but the app
cannot, stop looking at the network and look at the password characters.

### 4. Dates must be handled in Asia/Karachi, not server UTC
Vercel serverless functions run in UTC. The owner logs morning and evening deliveries in Pakistan time. A delivery logged near midnight PKT can land on the wrong calendar day if you use `new Date()` server-side.

**Rule:** compute "today", date-range filters, and day grouping in the `Asia/Karachi` timezone. Use `date-fns-tz` (or Intl with timeZone: "Asia/Karachi"). Store timestamps in UTC in the DB, convert for display and for day-bucketing.

### 5. Never mutate historical prices
When a sale is created, snapshot `product.price` into the line item's `unitPrice`. Read historical totals from the snapshot, never re-join to `product.price`. Editing a product price later must not change any past record.

---

## Design System (single source of truth for all UI)

The frontend must feel calm, fast, and legible for a shop owner using a cheap Android phone in bright daylight. Prioritize clarity and speed over decoration. Beautiful means precise spacing, confident typography, and purposeful motion, not gradients-for-the-sake-of-it.

### Foundations
- **Base palette:** zinc/neutral. Background `zinc-50` (light) with white cards. Text `zinc-900` primary, `zinc-500` secondary.
- **Module accents:** Beverages = blue (`blue-600`), Bakery = amber (`amber-600`), Milk = emerald (`emerald-600`). Each module's pages, active nav item, and primary buttons use its accent. Never mix accents on one screen.
- **Semantic money colors:** money owed to others / positive receivable = emerald; money owed by others / debt = rose; neutral/settled = zinc.
- **Radius:** rounded-xl (12px) on cards, rounded-lg on inputs and buttons. Consistent everywhere.
- **Elevation:** one soft shadow for resting cards (`shadow-sm`), a slightly stronger one for dialogs/sheets. No heavy drop shadows.
- **Density:** generous. Card padding 16-20px. Never cramp numbers together.

### Typography
- Font: Inter (or Geist) via next/font. One family, weights 400/500/600/700.
- Type scale: page title 24/semibold, section 18/semibold, body 14-15/regular, labels 13/medium uppercase-tracking for table headers, big stat numbers 28-32/bold (tabular-nums).
- **All numbers use `tabular-nums`** so columns align. Money formatted as `Rs. 1,250` with thousands separators. Dates as `DD/MM/YYYY`.

### Spacing & layout
- 4px spacing rhythm (4, 8, 12, 16, 24, 32).
- Mobile-first. Content max-width ~640px on phone, comfortable multi-column on desktop.
- Touch targets minimum 44px. Numeric inputs use `inputMode="decimal"`.

### Motion (Framer Motion)
- Purposeful, quick, spring-based. Nothing should feel slow.
- Page/tab transitions: subtle fade + 8px slide, ~200ms.
  - **Routes:** owned by `app/(dashboard)/template.tsx` — one place, every page.
    `template.tsx` not `layout.tsx`, because only a template gets a fresh instance
    per navigation. **The first server-rendered paint deliberately does not
    animate** (a module-level `hasHydrated` flag): `useReducedMotion()` cannot
    work on the server, so SSR would otherwise paint the travelling `initial`
    into the HTML and a reduced-motion user would get the slide anyway. Screens
    must NOT add their own top-level section entrance — that reads as two
    animations for one navigation.
  - **Tabs:** wrapped per `<TabsContent>` in the consuming screen
    (`components/milk/FarmerProfile.tsx`), not in `components/ui/tabs.tsx`. Radix
    unmounts a panel's children when inactive, so a plain `motion.div` re-enters
    on every switch and no `AnimatePresence` is needed.
- Stat numbers: count-up on mount (respect the value type, format after animating).
- Dialogs/sheets: spring scale/slide via AnimatePresence.
- List rows: `layout` animation when items are added/removed.
- **Always respect `prefers-reduced-motion`** and disable non-essential animation when set.

#### ⚠️ There are TWO StatCards. A money-display fix must be applied to BOTH.

| | Where | Money display |
|---|---|---|
| **Shared** | `components/shared/StatCard.tsx` — used by the **dashboard** only | **Re-implements** the count-up: `useMotionValue(0)` + `useTransform` + `animate(count, value, …)` |
| **Private** | `StatCard` defined inside `components/reports/ReportsDashboard.tsx` (~:450) — used by its own 5 tiles | **Delegates** to `<AnimatedMoney countUpOnMount />` |

Same name, different components, different contracts — the shared one takes `icon`/`accent`/
`format`/`trend`; the private one takes `loading`/`failed`/`onRetry`/`tone`/`border`. Neither is
wrong, and they are deliberately **not** merged: converging them would have to pick one money-display
mechanism and change the other screen.

**Why this warning exists:** the reduced-motion "Rs. 0 instead of Rs. 3,500" bug was fixed in
`AnimatedMoney` and **survived in the shared StatCard for weeks**, because a fix applied to one copy
looks complete. It was caught on 2026-08-11 and fixed in `beb8de7`. **If you touch how either
displays money, check the other.**

#### 🎬 `lib/motion.ts` is THE motion vocabulary. Do not hand-roll a transition.

**Every duration, spring and entrance variant lives in one file.** Before it existed, each animated
component defined its own transition inline — which produced **six spring configs and three
durations across 13 components**, several near-identical and clearly meant to be the same thing
(`420/34` alone appeared six times). Adding a fourteenth screen meant inventing a seventh spring.

If you need a transition, import one. If none fits, **add a named one there** rather than inlining a
value at the call site.

| Export | Value | Use for |
|---|---|---|
| `SPRING.section` | 420 / 34 | **The canonical one.** A page section or card arriving. Reach for this first |
| `SPRING.snap` | 500 / 40 | Snapping into place — bottom-nav indicator, catalog rows |
| `SPRING.lineItem` | 480 / 38 | A sale line added/removed in the new-sale form |
| `SPRING.saleRow` | 480 / 40 | A sale row reflowing in the list (`layout="position"`) |
| `SPRING.collapse` | 400 / 40 | height 0 ↔ auto disclosure |
| `SPRING.money` | 380 / 40, `restDelta: 0.5` | A money figure travelling to a NEW value. **Do not soften** — wobble on money reads as an error |
| `TWEEN.fast` | 0.15s | Inline feedback, e.g. a form error |
| `TWEEN.page` | 0.2s easeOut | The Design System's ~200ms page transition |
| `TWEEN.countUp` | 0.7s easeOut | Stat count-up (StatCard + AnimatedMoney mount) |
| `TWEEN.none` | 0 | A hard cut — reduced motion |

**Variant helpers take `reduceMotion` and handle it internally**, so a component cannot forget it:
`enterUp` · `enterLeft` · `rowInOut` · `lineItemInOut` · `collapseInOut` · `feedbackIn` ·
`indicatorTransition` · `moneyTransition`. Usage:

```tsx
const reduceMotion = useReducedMotion();
<motion.div {...enterUp(reduceMotion)}>              // initial/animate/transition
<motion.div {...enterUp(reduceMotion, SPRING.snap)}> // same shape, different feel
```

They set `initial: false` under reduced motion rather than a zero-length transition — that is what
makes an element appear already in place instead of travelling instantly.

**⚠️ `lineItem` (480/38), `saleRow` (480/40) and `collapse` (400/40) are near-duplicates left
UNMERGED on purpose.** The extraction was a pure refactor with no intended visual change, and
collapsing them would have been one. Merging them is a real (small) visual decision — do it as its
own change, with the sale list and new-sale form open in a browser.

### Component quality bar
- Use shadcn/ui for every primitive. Do not hand-build inputs, tables, dialogs, or selects.
- Every list/table has three states designed: loading (Skeleton), empty (friendly message + primary action, e.g. "No sales yet. Add your first sale."), and error (retry).
- Every destructive action has a confirm dialog.
- Every form submit button shows a spinner and disables while pending.
- Toast on every create/update/delete (success and error).

### 💰 THE RECEIPT PRINTS PAISE. THE SCREEN ROUNDS. DELIBERATE — do not "fix" either.

**Screen: `formatPKR(v)` → whole rupees. Receipt: `formatPKR(v, { precise: true })` → two
decimals.** Same stored numbers, two precisions, on purpose. `{ precise: true }` appears in exactly
ONE place in the codebase — `components/receipt/ReceiptDocument.tsx`. Keep it that way in both
directions: do not round the receipt to match the screen, and do not add paise to the screen to
match the receipt.

The reason is not consistency, it is arithmetic:

```
rounded : 3 × Rs. 276    = Rs. 827      <- does not multiply out
precise : 3 × Rs. 275.50 = Rs. 826.50   <- it does
```

**A receipt is the one document a customer checks with a calculator, standing in front of the
owner.** A bill whose own arithmetic fails loses him the argument even when his records are right.
The screen carries no such duty — it is a summary he scans, and whole rupees are easier to read down
a column.

Found by printing a real sale: the first build of the receipt used the screen's rounded form and
produced `3 × Rs. 276 ... Rs. 827`. A green build could never have shown it.

*(Knock-on: the unit price inside a quantity row drops the `Rs.` prefix — `2 cottons × Rs. 380.00`
is 34 characters and overflows a 58mm roll, while `2 cottons × 380.00` fits and the currency is
unambiguous from the total on the same line.)*

#### Two more line-budget rules, both found by printing a real bill (2026-08-14)

- **🥛 LITRES PRINT AS `L`, not "litres".** `12.5 litres × 12… Rs. 1,500.00` truncated the RATE at 32
  characters; `12.5 L × 120.00   Rs. 1,500.00` fits. A truncated unit price is the same failure the
  paise rule exists to prevent — the customer cannot check the arithmetic. The SCREEN still says
  "litres"; it has the room. In `formatQuantity`, `components/receipt/ReceiptDocument.tsx`.
- **The `Subtotal` row prints ONLY when it differs from `TOTAL`.** A subtotal exists to explain a
  discount; with none it repeats the total, spending a line and inviting the customer to ask what the
  difference is. Every unified sale is in this case by construction (that endpoint has no discounts),
  as is any per-module bill sold at full price. A discounted bill still prints Subtotal → Discount →
  TOTAL, unchanged. Matches the owner's answer on the mixed receipt: **one flat list, one total.**

### Receipt printing (thermal) — ✅ 80mm CONFIRMED AND SHIPPED (2026-08-20)

**The owner confirmed an 80mm printer on 2026-08-20, and the code now matches:
`RECEIPT_LINE_CHARS = 48`.**

| Roll | Print head | Font A (12 dots/char) | Font B (9 dots/char) |
|---|---|---|---|
| 58mm | 384 dots | 32 chars/line | 42 |
| **80mm (confirmed)** | 576 dots | **48 chars/line** | 64 |

#### 🔴 CHANGING PAPER SIZE IS **THREE** EDITS. Miss one and it fails silently.

| # | What | Where | Now |
|---|---|---|---|
| 1 | The **character grid** the money columns align to | `RECEIPT_LINE_CHARS`, `lib/settings-display.ts` | **48** |
| 2 | The **screen** paper width | `.receipt-paper { width }`, `app/globals.css` (~:134) | **80mm** |
| 3 | The **PRINT** paper width | `.receipt-paper { width }` inside `@media print`, same file (~:211) | **80mm** |

**Only #1 propagates.** Dividers, wrapping, centring, padded money rows, the line clamp and the
`shopName` cap all derive from the constant — which is why this is a three-line change and not a
layout rewrite. **Never hardcode 48.**

**#3 is the dangerous one and was nearly missed on 2026-08-20.** It is a SECOND copy of the width
inside the print media query, and it is the one that actually reaches the printer. Getting #1 and #2
right while leaving #3 at 58mm gives you a preview that looks perfect on screen and a physical roll
that wraps every line into nonsense — with nothing on screen to warn you, because the screen is
using the other rule. It was caught by grepping for residual `58mm` after the change, not by looking
at the page.

Change one without the others and you get: 48-character lines squeezed into a 58mm page (#1 alone),
a 32-character receipt marooned in the middle of an 80mm roll (#2 alone), or the silent failure
above (#3 forgotten).

**Verified at 80mm, three ways** (2026-08-20), because a green build has never once caught a receipt
bug in this project:

1. **The text layer**, via a fixture through `buildReceiptLines` — 21 lines, longest exactly 48, none
   over.
2. **The physical fit**, measured in the browser against the app's own stylesheet: 48 chars = 281.3px
   of text inside 287.2px of content width. **6px of headroom.** The monospace advance turned out to
   be 5.86px, not the 6.0px a back-of-envelope estimate gives — which would have predicted an
   overflow that does not happen. Measured, not assumed.
3. **A real rendered receipt** in the browser: money column ending at column 48 on every row, no
   horizontal scroll, and the arithmetic multiplying out (`2 peti × 7,000.00 → Rs. 14,000.00`).

**What the extra 16 characters bought:** the phone line (three numbers, 35 chars) and the address
(46 chars) each now fit on **ONE** line instead of wrapping to two — so the header is 3 lines
instead of 5.

**⚠️ If the printer is ever swapped back to 58mm, BOTH values must go back** (32 and 58mm). The
asymmetric-risk argument that made 58mm the default-when-unsure is unchanged and still correct — it
is simply resolved now. It was: a 58mm layout also prints on 80mm, just leaving margin, whereas an
80mm layout overflows 58mm and wraps every line into nonsense. That is why this stayed at 32 for a
week after 80mm was *recommended*, and only moved when it was *confirmed*.

**Double-width header text halves the budget to 24 characters.** That is a RENDERING decision for
the receipt, not a validation one: print a long shop name at normal width rather than letting the
validator reject a real name that would fit perfectly.

**Field caps derived from this** (see also CHECKLIST #2b):

| Field | Cap | Why |
|---|---|---|
| `shopName` | **48** | Exactly one 80mm line — moved from 32 automatically when the constant changed, because it is DERIVED |
| `shopPhone` | 60 | Now ~1.5 lines at 48 chars; enough for three numbers as free text |
| `shopAddress` | 200 | Wraps to ~4 lines at 48 chars; a paste guard, not a format rule |

---

## Folder Structure

### URL layout (decided, do not change without a reason)

**The app is served at the root.** `(dashboard)` is a parenthesised route group, so it
contributes a shared layout and contributes NOTHING to the URL. There is no literal
`/dashboard` folder and none should be added.

| Page | URL |
|---|---|
| Dashboard home | `/` |
| Screens | `/sales`, `/milk`, `/customers`, `/catalog`, `/reports`, `/settings` |
| Login | `/login` — **the only unauthenticated page** |

`DEFAULT_LOGIN_REDIRECT` is `"/"`. Route constants live in `/lib/routes.ts`.

```
/app
  /api                     → Route Handlers (serverless). runtime="nodejs" where Prisma/bcrypt used.
    /sales/route.ts        → UNIFIED sale POST (S3, live 2026-08-13) + GET list (S4.1,
                             2026-08-14). Beverages+bakery+milk on ONE bill; no discounts.
    /sales/[id]/route.ts   → GET one + PATCH + DELETE. ⚠️ The DELETE RESTORES STOCK — and
                             normalises `Number(item.quantity)` first, because
                             SaleItem.quantity is Decimal and computeStockDeltas takes a
                             number.
  /receipt/sale/[id]       → THE receipt. `/receipt/[module]/[id]` was deleted in S9.
  /(dashboard)/sales/      → the till: list + /sales/new + /sales/[id]/edit. ZINC accent,
                             because a bill spanning shops claims no shop's colour.
  /(auth)/login            → Owner login page → /login
  /(dashboard)             → layout group ONLY, adds nothing to the URL
    /layout.tsx            → Protected layout with nav
    /page.tsx             → Dashboard home (summary + charts) → /
    /milk/                → FARMERS only: deliveries, purchases, quick entry, balances.
                            Milk is SOLD on the till like everything else (S4.3/S9).
    /catalog/             → Category + product manager
    /customers/           → Customer ledger + receivables
    /reports/             → Analytics + CSV export
/components
  /ui                     → shadcn components (auto-generated, do not hand-edit)
  /sales  /milk  /customers  /catalog  /reports  /receipt
  /shared                 → DataTable, PageHeader, StatCard, MoneyText, EmptyState, etc.
/lib
  /prisma.ts              → Prisma client singleton
  /auth.ts                → Full NextAuth (Node) config
  /auth.config.ts         → Edge-safe NextAuth config for middleware
  /routes.ts              → Route constants (dependency-free, client+edge safe)
  /serialize.ts           → Decimal → number serializers (money/liters)
  /format.ts              → formatPKR(), formatDate(), Karachi date helpers
  /utils.ts               → misc helpers
  /sales.ts               → THE money + stock + price-snapshot + line-reconciliation
                            implementation. Shared by every sale path (there is one).
  /unified-sales.ts       → loadUnifiedSaleProducts, resolveLineModule,
                            UNIFIED_SALE_PRODUCT_SELECT, UNIFIED_SALE_DETAIL_SELECT
  /modules.ts             → MODULE_CATEGORIES (beverages | bakery | milk) → Category
  /milk.ts                → FARMER side only: deliveries, purchases, balances, ledger
                            (`lib/milk-sales.ts` went with the MilkSale table in S9)
  /milk-statement.ts      → ONE farmer over ONE date range, for the spreadsheet
                            the owner hands over. Carries the period net AND the
                            all-time balance, labelled — they are different
                            numbers and a farmer cannot tell which he is holding
  /milk-stock.ts          → the DELIVERY-TO-STOCK BRIDGE
  /receivables.ts         → THE customer balance calculation
/prisma
  schema.prisma           → single source of truth
  seed.ts                 → initial products, AND the milk catalog product (cat_milk /
                            sub_milk / prod_milk). Grep it before dropping any Product
                            column — it is in no component tree, so a UI-shaped search
                            misses it (this bit us once; see CHECKLIST #9).
  /migrations/            → never edit manually
/scripts
  create-owner.ts         → one-time owner account seeder
```

---

## Database Schema (Prisma)

### Catalog

```prisma
model Category {
  id            String        @id @default(cuid())
  name          String        // "Beverages" | "Bakery" | "Milk Shop"
  subCategories SubCategory[]
  createdAt     DateTime      @default(now())
}

model SubCategory {
  id         String    @id @default(cuid())
  name       String    // e.g. "Pepsi", "Cake Rusk", "Juices"
  categoryId String
  category   Category  @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  products   Product[]
}

model Product {
  id              String       @id @default(cuid())
  name            String       // e.g. "Pepsi 1.5L", "Premium Cake Rusk"
  subCategoryId   String
  subCategory     SubCategory  @relation(fields: [subCategoryId], references: [id])
  price           Decimal      @db.Decimal(10, 2)
  size            String?      // "half_litre" | "1L" | "1.5L" | "2.25L" | "large" | "small" | null
  // NO discountPercent. Dropped 2026-08-10 (CHECKLIST #9). A discount is a
  // sale-time percentage snapshotted on the LINE, never a product attribute.
  qualityTier     String?      // "premium" | "simple" | null
  shape           String?      // "circle" | "rectangular_round" | null (russ)
  unit            String?      // "cotton" (eggs) | "piece" | "bottle" | "litre" (milk) | null
  // DECIMAL, not Int — widened by Migration D (2026-08-12). Milk sells in
  // fractional litres and an integer column cannot be decremented by 12.5.
  // Countable goods just carry a .00 scale. Seed default is 100 (a placeholder
  // the owner replaces by counting the shelf); prod_milk overrides it to 0.
  stock           Decimal      @default(100) @db.Decimal(10, 2)
  isActive        Boolean      @default(true)
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  coolingCharge   Decimal?     @db.Decimal(10, 2)  // Migration E. NULL != 0 — see #17
  // Migration F: the packs this product also sells in. Stock stays ONE pool,
  // counted in the base `unit`; a ProductUnit only says how many base units
  // leave it per pack. See CHECKLIST #19.
  units           ProductUnit[]

  // REQUIRED back-relations (do not remove, migration fails without them)
  saleItems         SaleItem[]        // the only one since S9
}

// A SELLING UNIT (Migration F, 2026-08-18). `baseFactor` is how many base units
// one of these contains — 12 for a dozen, 360 for a peti of eggs, 12 for a pet
// of most bottles here (NOT 24). `price` is the price OF THE PACK, not per base
// unit: a peti is not 360 x the single-egg price, which is exactly why it is
// stored rather than derived.
model ProductUnit {
  id         String   @id @default(cuid())
  productId  String
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  name       String   // "dozen" | "tray" | "peti" | "pet" | "pet 4" — the owner's word
  baseFactor Decimal  @db.Decimal(10, 2)
  price      Decimal  @db.Decimal(10, 2)
  isDefault  Boolean  @default(false)
  createdAt  DateTime @default(now())

  @@unique([productId, name])
  @@index([productId])
}
```

### 🥛 The milk catalog product (created 2026-08-13 via `prisma/seed.ts`)

Milk is **one product, sold by the litre**, so a single bill can hold beverage, bakery and milk lines
together:

| Row | Value |
|---|---|
| `Category` | `cat_milk` — name **"Milk Shop"** |
| `SubCategory` | `sub_milk` — "Milk" |
| `Product` | `prod_milk` — "Milk", `unit: "litre"`, `price 0` |

**The name "Milk Shop" and the id `cat_milk` are load-bearing** — they are how `resolveLineModule`
(`lib/unified-sales.ts`) maps a line to `moduleKey: "milk"`, matching `MODULE_CATEGORIES.milk` in
`lib/modules.ts`.

**🔴 `stock` STARTS AT 0, not the seed's default of 100**, because milk stock is **derived**:
farmer deliveries ADD to it (the bridge, `lib/milk-stock.ts`) and unified sales SUBTRACT. Seeding 100
would invent a hundred litres that never arrived. `ProductSeed` carries an optional `stock` for
exactly this one case.

```prisma
// The unified sale line. quantity is DECIMAL (Migration C, 2026-08-11) so a
// fractional-litre milk line is an ordinary line.
model SaleItem {
  quantity        Decimal @db.Decimal(10, 2)
  moduleKey       String   // "beverages" | "bakery" | "milk" — SNAPSHOT, never re-derived
  netLineTotal    Decimal @db.Decimal(10, 2)
  coolingRate     Decimal @default(0) @db.Decimal(10, 2)  // Migration E, SNAPSHOT
  // Migration F, both SNAPSHOTS. unitName is what the bill says it sold ("2
  // peti"); unitFactor is what stock moved by (quantity x factor = base units).
  // Re-defining or deleting the catalog's unit cannot move a closed bill.
  unitName        String?
  unitFactor      Decimal @default(1) @db.Decimal(10, 2)
  // ... see prisma/schema.prisma for the full model
}
```

### Customers (shared across all sales) + Receivables

```prisma
model Customer {
  id            String            @id @default(cuid())
  name          String
  phone         String?
  type          String            // "hotel" | "individual" | "shop"
  isActive      Boolean           @default(true)
  sales         Sale[]
  payments      CustomerPayment[]
  createdAt     DateTime          @default(now())
}

// Tracks money the customer has PAID. Outstanding balance is computed:
// (sum of all their sales) - (sum of their payments).
model CustomerPayment {
  id          String   @id @default(cuid())
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  paymentDate DateTime @default(now())
  amount      Decimal  @db.Decimal(10, 2)
  method      String?  // "cash" | "transfer" | null
  notes       String?
  createdAt   DateTime @default(now())
}
```

### ~~Beverages / Bakery~~ — dropped by Migration B (S9)

`BeverageSale`, `BeverageSaleItem`, `BakerySale` and `BakerySaleItem` were here. A bill of either
kind is now a `Sale` whose lines carry `moduleKey`, which is the only shape that can represent what
the owner actually sells: one customer, one bill, items from more than one shop.

### Milk Shop

```prisma
model Farmer {
  id         String           @id @default(cuid())
  name       String
  phone      String?
  address    String?
  isActive   Boolean          @default(true)
  deliveries MilkDelivery[]
  purchases  FarmerPurchase[]
  createdAt  DateTime         @default(now())
}

model MilkDelivery {
  id            String   @id @default(cuid())
  farmerId      String
  farmer        Farmer   @relation(fields: [farmerId], references: [id])
  deliveryDate  DateTime
  morningLiters Decimal? @db.Decimal(8, 2)   // null if no morning delivery
  eveningLiters Decimal? @db.Decimal(8, 2)   // null if no evening delivery
  ratePerLiter  Decimal  @db.Decimal(8, 2)
  totalLiters   Decimal  @db.Decimal(8, 2)   // computed: (morning ?? 0) + (evening ?? 0)
  totalAmount   Decimal  @db.Decimal(10, 2)  // computed: totalLiters * ratePerLiter
  notes         String?
  createdAt     DateTime @default(now())

  @@index([farmerId, deliveryDate])
}

model FarmerPurchase {
  id              String   @id @default(cuid())
  farmerId        String
  farmer          Farmer   @relation(fields: [farmerId], references: [id])
  purchaseDate    DateTime @default(now())
  itemDescription String   // "Cow food" | "Milk" | "Yogurt" | "Tea powder" | custom
  amount          Decimal  @db.Decimal(10, 2)
  notes           String?
  createdAt       DateTime @default(now())

  @@index([farmerId, purchaseDate])
}

// ⚠️ MilkSale WAS HERE — dropped by Migration B (S9).
//
// Milk SOLD is a Sale with a milk line: prod_milk, quantity in litres. The two
// models above are milk BOUGHT from farmers — no customer, no product, and
// nothing to do with the till. Keep them apart; the sign convention alone
// (positive means the OWNER owes) is the module's sharpest trap.
```

### User (auth)

```prisma
model User {
  id        String   @id @default(cuid())
  name      String?
  email     String   @unique
  password  String   // bcrypt hash
  createdAt DateTime @default(now())
}
```

---

## 🧭 ONE SALE TABLE: `Sale` / `SaleItem` — S9, 2026-08-18

**Every bill in the app is a `Sale` with `SaleItem` lines.** There is one till (`/sales/new`), one
list (`/sales`), one receipt (`/receipt/sale/[id]`), and one place money is read from.

> **This section spent months warning that the OPPOSITE was true** — that the app ran on
> `BeverageSale`/`BakerySale` while `Sale` sat empty, and that session briefs kept claiming the
> switch-over had happened when it had not. That is over: it has now genuinely happened. The habit
> the old warning taught is still the right one, so it is restated in the new direction:
> **if something tells you a per-module sale table is still live, run the grep. The grep wins.**

```bash
# Must return NOTHING. A match means someone reintroduced a per-module sale path.
grep -rn "beverageSale\|bakerySale\|milkSale" app lib components --include=*.ts --include=*.tsx
```

The stronger check is that **the Prisma client no longer has those models at all** — the schema
dropped them in S9, so a call to `prisma.bakerySale.*` is a type error, not a runtime surprise.

| Thing | Where |
|---|---|
| Create a sale | `POST /api/sales` → `tx.sale.create`, any mix of shops on one bill |
| List / read / edit / delete | `/api/sales`, `/api/sales/[id]` |
| Sale form | `components/sales/UnifiedSaleForm.tsx`, at `/sales/new` and `/sales/[id]/edit` |
| Per-shop view | the **Shop filter** on `/sales` — `items: { some: { moduleKey } }` |
| Reports revenue | `Σ netLineTotal` grouped by `SaleItem.moduleKey` |
| Receipt | `loadUnifiedReceipt` in `lib/receipt.ts` |

### What S9 deleted, so nobody goes looking for it

`/beverages`, `/bakery`, `/milk/sales` and their `new-sale` screens · `/api/{beverages,bakery}/sales`
· `/api/milk/sales` · `/receipt/[module]/[id]` · `NewSaleForm`, `SalesList`, `SaleLineItems`,
`MilkSaleDialog`, `MilkSalesList` · `lib/sale-modules.ts` (its two accent-class maps moved to
`lib/nav.ts`, which is where `AccentKey` already lived) · `lib/validations/sales.ts` (the list query
moved to `lib/validations/unified-sales.ts` and gained `module`) · `lib/hooks/use-sales.ts` ·
`lib/milk-sales.ts` · the milk-sale hooks in `lib/hooks/use-milk.ts`, which is now the farmer side
only · the `beverages_sales` / `bakery_sales` / `milk_sales` CSV exports.

### 🔴 `notAMigrationCopy()` IS GONE. Do not reinstate it.

Every aggregate over `Sale` used to carry a `NOT EXISTS` against the three old sale tables, because
Migration A and S5 copied the real bills into `Sale` **keeping their ids** — so each existed twice
and any sum reading both counted it twice. With one copy left it matches nothing.

**If a figure ever looks doubled again, the cause is a genuine duplicate row**, not a missing filter.

The lesson it left behind is kept as **Gotcha 3b**: it had to be a FUNCTION, not a top-level
`const`, because a top-level `Prisma.sql` is evaluated wherever the module is bundled — including the
browser, where it threw `sqltag is unable to run in this browser environment` and killed `/reports`
on hydration while every build and test stayed green.

### ✅ Migration B — APPLIED 2026-08-18. `public` holds 14 tables.

`prisma/migrations/20260818210000_drop_per_module_sale_tables/` dropped `BeverageSale`,
`BeverageSaleItem`, `BakerySale`, `BakerySaleItem` **and `MilkSale`** — 7 `DROP CONSTRAINT` then 5
`DROP TABLE`, no `CASCADE`. Generated by the READ-ONLY `migrate diff --from-schema-datasource` and
applied with `prisma migrate deploy` (12/12 applied).

**It destroyed no data**, and that was established before it ran rather than hoped for: every bill in
those tables was already in `Sale` under the same id, checked by a pre-flight that looks for old rows
missing from `Sale` and found none.

`MilkSale` was outside the original scope, which predated the milk cutover; it went with the owner's
explicit approval (2026-08-18).

**Verified after:** the five tables gone from `information_schema`; 14 tables left, RLS on every one,
FORCE RLS on none; the 27-product fingerprint `b57a51bb57be89cbc9db646d4a2a9972` unchanged; both real
sales still Rs. 5,000 and Rs. 6,000; outstanding still 11,000; every report figure identical; and a
full sale round trip through the till — 1 dozen eggs took stock 100 → 88 and deleting it restored
100.

**The backup that made it safe:** `E:/Carreer_efforts/backup5.sql`, verified BY CONTENTS first —
ends with `-- PostgreSQL database dump complete`, 19 `COPY` blocks, no `DROP`/`TRUNCATE`, and row
counts matching live exactly (Product 75, ProductUnit 60, Sale 2/2, and all five dropped tables
present **with their data**).

---

## Critical Business Rules

### Farmer net balance (milk bought FROM farmers)
```
totalMilkValue = SUM(MilkDelivery.totalAmount) for farmer
totalPurchases = SUM(FarmerPurchase.amount) for farmer
netBalanceOwed = totalMilkValue - totalPurchases
```
- Positive netBalanceOwed = owner owes the farmer money (show emerald).
- Negative = farmer over-purchased and owes the owner (show rose).
- No fixed settlement date. Running balance, owner settles manually. Do not delete records to settle (a Settlement record is a future enhancement).

### Customer receivables (money owed TO the owner)
```
totalBilled      = SUM(sales.totalAmount) for customer          -- one table since S9
totalPaid        = SUM(CustomerPayment.amount) for customer
outstanding      = totalBilled - totalPaid
```
- Positive outstanding = customer owes the owner (show rose). This answers "who owes me money".
- Record payments against a customer; never edit past sales to reflect payment.
- NOTE: if the client does not want credit tracking, Phase 4b (payments UI) can be skipped and the receivables view simply shows total billed. Confirm with the client.

### Price snapshot
- On sale creation, copy current `product.price` into line-item `unitPrice`.
- Historical records always read `unitPrice`, never re-join to product.
- Editing a sale is allowed. Totals are always recomputed inside a transaction.

**Exactly when a line re-snapshots the current price (decided Phase 3.1 — do not loosen).
Verified against `lib/sales.ts` on 2026-08-11; this table is what the code does today:**

| Edit to a line | Price behaviour |
|---|---|
| New line added | **Re-snapshot** — copy current `product.price`, **or** an explicit `unitPrice` from the request if one is sent (create only) |
| Line's `productId` changed (in place) | **Re-snapshot FROM THE DATABASE** — it is a different item, the old price is meaningless for it |
| Line's `quantity` changed, same product | **KEEP the stored `unitPrice`** |
| Line untouched | **KEEP the stored `unitPrice`** |
| Explicit `unitPrice` sent for an **existing** line | **IGNORED.** The server is authoritative on update — see below |

#### 🔒 The create/update asymmetry is deliberate. Do not "fix" it for symmetry.

**CREATE honours a client `unitPrice`. UPDATE ignores it.** Closed 2026-08-11 (was CHECKLIST #7).

- **Create needs the override**, because the seed ships every product at `price 0` — the owner has
  to be able to bill a real price before walking the whole catalog.
- **Update must refuse it**, because honouring it lets a client set any price on a historical line,
  which is the exact mutation this whole rule exists to prevent.

`components/sales/NewSaleForm.tsx` **always** sends a `unitPrice` (see the comment at its `:218`).
So an edit screen built on that form would have re-priced a closed bill just because the owner
corrected a quantity — silently, with nothing in the response to show it. That is why this was
fixed *before* the sale edit UI (CHECKLIST #8) exists, rather than after.

Implemented in the update branch of `reconcileSaleLines()`: `line.unitPrice` is not read at all
for an existing line; the price is `productChanged ? product.price : prior.unitPrice`.
`snapshotUnitPrice()` is now **create-only** — do not call it for an existing line.

**Quantity is NOT a re-price trigger, deliberately.** Correcting "12 crates" to "15" on a
months-old sale is a typo fix, not a re-sale; re-pricing it at today's catalog price would
silently move a historical total the owner never asked to change. An earlier draft of this
rule said "any changed line re-snapshots" — that was rejected on review. Do not restore it.

The decision is implemented ONCE, in `reconcileSaleLines()` in `lib/sales.ts`, as a pure
function so it can be tested without HTTP. Beverages uses it; Bakery (Phase 4) must reuse it
rather than re-implement the predicate. Sale PATCH responses return `repricedItemIds` so the
UI can show which lines genuinely took a new price.

**A product swap re-snapshots the PRICE but deliberately NOT the DISCOUNT.** A discount is a
decision about the bill, not a property of the product; swapping the item on a line does not
undo the deal the owner struck. Send a `discountPercent` to change it, omit it to keep the
stored one.

#### 🔒 LOAD-BEARING: the reconciler matches lines by STABLE LINE ID, never by array index

**Do not "simplify" `reconcileSaleLines()` into an index walk over the submitted array. This is
the single easiest cleanup in the repo to make, and it silently rewrites history.**

The submitted array is the COMPLETE desired set of lines, and identity comes from the `id`
field alone:

```
entry WITH an id     -> that stored line, kept or edited   (looked up in currentById)
entry WITHOUT an id  -> a new line
stored line absent   -> removed from the sale
```

Index-matching breaks the moment a line is deleted from the middle of a bill: every line below
the gap shifts up one, gets compared against a DIFFERENT stored line, reads as
"productId changed", and **re-snapshots at today's catalog price** — silently moving the total
of a closed sale that the owner only opened to delete one row from. Nothing about that is
visible in the response; the bill just quietly becomes worth something else.

Two guards go with the id lookup and must stay:

- the same `id` submitted twice → **400**, "The same sale line was submitted twice."
- an `id` that is not on this sale → **409**, "Reload and try again." (someone else's line, or a
  stale form)

#### ✅ CLOSED 2026-08-11: the client `unitPrice` override no longer applies on UPDATE

Kept here as a record so nobody re-opens it. The hole was: `snapshotUnitPrice()` let an explicit
`unitPrice` from the request body beat the stored snapshot on a PATCH, while
`components/sales/NewSaleForm.tsx` always sends one — so any future edit screen would have
silently re-priced closed bills.

**Fixed:** the update branch of `reconcileSaleLines()` no longer reads `line.unitPrice` at all.
An existing line's price is `productChanged ? product.price : prior.unitPrice` — database or
stored snapshot, never the client. The override survives on **create** only, and
`snapshotUnitPrice()` is now documented create-only.

**Verified over authenticated HTTP** (there is still no edit UI, so the route was exercised
directly): a PATCH sending a bogus `unitPrice` on a quantity-only change left the stored snapshot
untouched. See the create/update asymmetry note above.

### Discounts, russ, eggs
- **Discount is a SALE-TIME PERCENTAGE, not a product variant** (reworked 2026-08-09). It is
  snapshotted in two places: `discountPercent` on the LINE and `discountPercent` on the SALE
  (whole-bill). Stacking order is line-first, then bill, with a rounding point at each —
  `computeLineTotal` / `applySaleDiscount` in `lib/sales.ts`, one implementation.
  ~~Discount variants are separate Product records~~ — **the 36 variant products were deleted in
  that rework**, and **`Product.discountPercent` no longer exists**: the column was dropped
  2026-08-10 (CHECKLIST #9, closed). A product cannot carry a discount, so a sale line cannot
  accidentally read one — which is the property the rework was buying. If you find yourself
  wanting a product-level discount, that is the variant model coming back; don't.
- Russ = 2 sizes (large/small) x 2 shapes (circle/rectangular_round) = 4 products, differentiated by `size` and `shape`.
- Eggs sold by the cotton: `unit: "cotton"`, quantity = number of cottons.

### Out of scope (do not build unless asked)
- ~~Physical stock / inventory counts~~ — **STOCK SHIPPED 2026-08-09.** `Product.stock`, decremented
  on sale, blocked with a structured `blockedBy` shortfall list when short, restored on delete, and
  reconciled BY DELTA on edit (`computeStockDeltas` / `applyStockDeltas` in `lib/sales.ts`).
  ~~Beverages + bakery only; milk has no products and no stock.~~ **Milk joined 2026-08-13** — see
  below.
- Multi-user roles, supplier invoicing, tax/GST.

### 🥛 Milk stock — ✅ AUTHORITATIVE since the S4.3 cutover (2026-08-14)

**Milk is a catalog Product (`prod_milk`, `unit: "litre"`, under `cat_milk` "Milk Shop") and both
directions are now covered:**

| Event | Effect on `prod_milk.stock` |
|---|---|
| A farmer delivery is recorded / edited / deleted | **+ / delta / −** the delivery's `totalLiters` — the bridge, `lib/milk-stock.ts` |
| A milk line on the till (`POST /api/sales`) | **−** the litres sold |
| A unified sale DELETED | **+** the litres restored (S4.1) |
| ~~A sale on `/milk/sales`~~ | **deleted 2026-08-18 (S9)** — screen, route and table all gone |

~~**The screen the owner uses does not decrement milk stock.**~~ **Closed by S4.3, and finished by
S9.** Milk selling moved to the unified till, and the old screen, `POST /api/milk/sales` and the
`MilkSale` table went with the rest of the per-module path. **Every litre in and out now moves
through exactly two places** — the delivery bridge and a till line — which is what makes the figure
checkable at all.

**⚠️ ONE CAVEAT, AND IT IS ABOUT THE OPENING NUMBER, NOT THE ARITHMETIC.** The arithmetic is sound;
the starting point is not a count of the fridge. **The owner sets the true opening litres at
handover**, exactly as he does for every other product's shelf count.

> 🔴 **SINCE THE DATA RESET (2026-08-19) THIS IS SHARPER: `prod_milk.stock` reads 4,050 L against an
> EMPTY delivery ledger.** The reset deleted every `MilkDelivery` but deliberately left stock alone
> (the owner said "leave the stock as is"), so the figure the bridge had built up no longer has any
> record behind it. **It is not inventory and nothing reconciles to it** — the till will still sell
> against it. Fix by SETTING the real count in the catalog's inline stock editor. See CHECKLIST #2.

#### The bridge's rules (all four delivery write paths)

**Reconcile BY DELTA, never by re-adding.** `lib/milk-stock.ts` holds `findMilkProductId()` and
`applyMilkStockDelta()`, which **delegates to `applyStockDeltas`** so "never negative" stays one
implementation, enforced in the database's `WHERE` clause.

- **🔴 Quick entry's EVENING pass is an UPDATE of the morning's row**, so it must add
  `new − prior` litres. Adding the full new figure would double-count the morning **every single
  day**. This is the main path, not an edge case.
- All four paths are wrapped in a transaction — delivery written FIRST, stock second: the farmer's
  record is primary, stock is the side-effect.
- **A reversal that would drive stock below zero is REFUSED with a 409 naming the fix**
  ("correct the milk stock in the catalog first"), never clamped and never allowed negative. The
  escape hatch is the catalog's inline editor, which SETS stock outright.
- **If the milk product is missing, the delivery still records** and the stock step is skipped with
  a `console.error`. A farmer's record must never be blocked by a catalog problem.

#### 🔒 `lib/milk.ts` must stay free of `product` and `stock`

The bridge lives in `lib/milk-stock.ts` **specifically** so that this stays true:

```bash
grep -c "product\|stock" lib/milk.ts     # must be 0
```

That grep is what makes "the bridge cannot change a farmer's money" a checkable property rather than
a promise — farmer balances, the ledger and the balance sheet cannot read the column the bridge
writes. Same reasoning as the S2 split of `lib/milk-sales.ts`. **Do not move bridge code into
`lib/milk.ts`.**

---

## Authentication
- Single owner, NextAuth v5 credentials provider, JWT session (no DB sessions).
- Password hashed with bcryptjs (12 rounds), stored in `User`.
- Split config (see Gotcha 3).
- **Middleware protects everything except `/login`, `/api/auth`, and static assets.**
  This is a single-owner app: the entire site is authenticated, and `/login` is the only
  public page. Do not narrow this to a path prefix — the app is served at the root
  (see URL layout above), so prefix-gating would leave the whole app open.
- **Rejection shape differs by request type, deliberately.** A signed-out request to a
  page redirects to `/login`; a signed-out request under `/api/` gets
  `401 {"data": null, "error": "You must be signed in."}` — the same `{ data, error }`
  envelope the route handlers use, so the UI can show a real message instead of choking
  on an HTML login page inside `res.json()`. Both paths are exercised by the Phase 2.1
  verification. Route handlers ALSO call `requireOwner()` for defence in depth: the
  middleware is the gate, the route check is the backstop if the matcher ever changes.
- **`useSecureCookies` is PINNED in `/lib/auth.config.ts` — never let it be inferred.**
  Auth.js derives the session-cookie NAME from whether it thinks the site is https
  (`__Secure-authjs.session-token` vs `authjs.session-token`), and it reads that from the
  resolved auth URL. `NEXTAUTH_URL` exists only for Production, so preview deployments picked
  the insecure name while the edge middleware looked for the secure one — sign-in succeeded,
  `/api/auth/session` returned the user, and every gated route still rejected it. Pinning the
  value means middleware and route handlers read the same static field and cannot disagree.
  Verified on a preview deployment: gated pages and APIs return 200 with a real session, and
  signed-out still gives 307 / 401 respectively.
- **`trustHost: true` is set explicitly in `/lib/auth.config.ts` and is the source of
  truth for host trust.** Auth.js v5 does NOT read `NEXTAUTH_URL` for this; it only
  auto-trusts when `AUTH_URL` / `AUTH_TRUST_HOST` / `VERCEL` is set, or when
  `NODE_ENV !== "production"`. Without the explicit flag, a production build outside
  Vercel throws `UntrustedHost` inside middleware and every request reads as signed out
  — dev and Vercel both mask it. No env-var rename is needed; keep `NEXTAUTH_SECRET`
  and `NEXTAUTH_URL` as named in the env contract below.
- `callbackUrl` from the query string is attacker-controlled. Resolve it against our own
  origin and drop anything off-site, or the login page becomes an open redirect.
- One-time `/scripts/create-owner.ts` seeds the owner account:
  `npm run create-owner -- <email> "<password>"` (upsert, so it doubles as a reset).
- No database adapter. Credentials + JWT sessions don't use one, and the Credentials
  provider is incompatible with DB sessions. `@auth/prisma-adapter` is NOT a dependency.

### 🔒 The login form's no-JS fallback is POST-only. Both attributes are LOAD-BEARING.

**`components/auth/login-form.tsx` carries `method="post"` and
`action={NO_JS_LOGIN_ROUTE}`. Removing either one re-opens a credential leak.** Fixed
2026-08-10; was CHECKLIST #1, now closed.

Without them a native submit — JS absent, a click before hydration, a failed chunk load —
defaults to **GET** and serialises the owner's email and password into the URL, where they land
in browser history, server and proxy access logs, and any onward `Referer`. That is the state
this repo shipped in until now; it was reproduced with the address bar showing
`/login?email=…&password=…`.

| Path | What runs |
|---|---|
| **JS working** (normal) | react-hook-form's `handleSubmit` calls `preventDefault()` **synchronously**, so the browser's native submit is cancelled and `signIn()` from `next-auth/react` posts to `/api/auth/callback/credentials` as before. The fallback route is never reached. |
| **JS absent / not yet hydrated** | The browser POSTs form-encoded to `/api/auth/no-js-login`, which exports **POST only** — Next answers GET/HEAD/PUT with **405**, so the credential path is incapable of accepting a query string. |

Three things about that route are deliberate and easy to break:

- **It lives under `/api/auth/`** because the middleware matcher excludes that prefix. Anywhere
  else under `/api/`, a signed-out POST would get the 401 envelope instead of reaching the
  handler. The hyphen keeps it from colliding with any Auth.js action on the `[...nextauth]`
  catch-all.
- **It answers 303, not 307, and calls `signIn` with `redirect: false`.** `redirect()` from
  `next/navigation` issues a **307 inside a Route Handler** (it only switches to 303 in a Server
  Action), and a 307 preserves the method — the browser would re-POST the credentials to the
  destination. The session cookie still arrives: Next merges anything written to `cookies()`
  into the returned Response.
- **It checks the URL `signIn` resolved to before treating the login as successful.** Auth.js
  does *not* always throw on failure — when `assertConfig` rejects the config it returns a 500
  before the raw/throw path, so `signIn` resolves normally, sets no cookie, and hands back its
  own endpoint URL. Found in verification with `NEXTAUTH_SECRET` missing: the route cheerfully
  303'd a session-less browser to `/`, which then bounced to `/login` with no explanation.
- **It brings its own CSRF check** (Origin, falling back to Referer), because `signIn` calls
  Auth.js with `skipCSRFCheck`. Without it a cross-site form could log the owner into someone
  else's account.

**Re-test with JavaScript actually disabled.** The bug is invisible with JS on — that is how it
survived seven phases.

---

## ⚠️ DATABASE SAFETY — hard-won guardrails

**On 2026-08-12 the live production database was destroyed by a single command run from this
repo. Every row was lost. It was recovered only because a manual backup existed.** This section
records what happened, the rule that follows from it, how the restore was done, and the backup
discipline that made recovery possible. Read it before running any Prisma CLI command that takes
a connection string.

### 1. 🔴 NEVER pass a real connection string to `--shadow-database-url`

**The command that wiped production:**

```bash
# ☠️ THIS DESTROYED THE LIVE DATABASE. Never run anything of this shape.
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "<DIRECT_URL — the production database>" \
  --script
```

**Why it destroys data — understand the mechanism, do not just memorise the command.** Prisma's
shadow database is a *disposable scratch database*. Prisma assumes it owns it completely, so it
**DROPS EVERY OBJECT IN IT** and then replays the migration history into the empty shell to
compute a diff. Whatever you hand that flag is what gets emptied. `DIRECT_URL` and `DATABASE_URL`
both point at production, so passing either one drops production.

Nothing about the flag name warns you, and there is no confirmation prompt.

> **THE RULE, ABSOLUTE:** `--shadow-database-url` takes a throwaway database and nothing else.
> Never `DATABASE_URL`, never `DIRECT_URL`, never anything read out of `.env`, never a Supabase
> connection string. If you cannot point to a database you would happily drop right now, you do
> not have a shadow database and must not use the flag.

**To generate migration SQL without a shadow database — use one of these instead:**

| Need | Command | Safety |
|---|---|---|
| Diff the live DB against the schema | `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` | **READ-ONLY** — introspects, writes nothing |
| Diff migration files against the schema | `--from-migrations` → `--to-schema-datamodel` **with no `--shadow-database-url`** | no live DB touched |

The read-only `--from-schema-datasource` form produced perfectly usable SQL thirty seconds after
the destructive attempt. **There was never a reason to involve a shadow database at all.**

Related: `prisma migrate reset` and `prisma db push` are also destructive. `migrate status` and
`migrate diff --from-schema-datasource` are read-only. Know which is which before you type it.

### 2. 🔴 A `P3006` against a real URL is a DAMAGE REPORT, not a failed command

The wipe announced itself and was misread:

```
Error: P3006
Migration `20260803000000_enable_rls` failed to apply cleanly to the shadow database.
Error code: P1014
The underlying table for model `public._prisma_migrations` does not exist.
```

That looks like "the command didn't work, try another approach". **It is not.** By the time this
prints, Prisma has *already* dropped everything in the target and is telling you **how far the
replay got before failing**. The 2026-08-12 incident lost an extra step of damage-awareness
precisely because this was treated as a dead end to route around rather than an alarm.

> **If `P3006` / "failed to apply cleanly to the shadow database" ever appears against a real URL:
> STOP IMMEDIATELY.** Do not retry. Do not try a different SQL-generation route. Do not run
> anything else. **Verify database state first** — row counts, `information_schema.tables`,
> `_prisma_migrations` — and report before doing anything at all.

**A more general habit that would have caught this in seconds:** when a diff or introspection
reports that tables you *know* exist are missing, treat it as evidence the database changed, not
as a tooling quirk. That is exactly how the wipe was eventually detected.

### 3. ✅ The restore procedure that worked (2026-08-12)

Recovery took one pass. Recorded so the next one is fast.

**Source:** a full `pg_dump` — **schema + data**. Not schema-only (see §4).

**Host — this detail cost real time.** Connect via the **session pooler**:

```
aws-1-ap-northeast-2.pooler.supabase.com:5432        ✅ works
db.<project-ref>.supabase.co:5432                    ❌ does not resolve from this network
```

The dashboard offers the `db.<ref>` direct host, and it simply does not resolve here. Use the
session pooler host (port **5432**, session mode — **not** 6543, which is transaction mode and
cannot run a restore).

**Steps:**

```sql
-- 1. clean target
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

```bash
# 2. load
psql "<session-pooler-url>" -f backup2.sql
```

**⚠️ The error flood during load is EXPECTED AND HARMLESS. Do not abort.** A Supabase dump
contains objects owned by Supabase-internal roles, and the `postgres` role cannot recreate them:

```
ERROR:  must be owner of ...
ERROR:  permission denied for schema auth
ERROR:  permission denied for schema storage
ERROR:  permission denied for schema realtime
```

**None of these affect your data.** The signal to watch is the **`COPY n` row counts for the
`public` schema** — `COPY 27` for `Product` and so on. Those are the restore actually landing.

**Verify after — all read-only:**

1. **Row counts** against known expectations.
2. **The product fingerprint** — far stronger than a count, because it proves the *contents*
   came back, not just the right number of rows:
   ```sql
   SELECT md5(string_agg(id||'|'||name||'|'||price::text||'|'||stock::text||'|'||"isActive"::text, ',' ORDER BY id))
   FROM "Product";   -- known-good: 95794a0bb44f1b15d541a60ef0bd5c51
   ```
   **Post-Migration-D the value-stable fingerprints are
   `91c0ca3185c4daadd4a9c7be1bfa0e77` (stock) and `b57a51bb57be89cbc9db646d4a2a9972` (product);
   the `95794…` value above predates Migration D.** Cast to `numeric(10,2)` on both sides
   (`(stock::numeric(10,2))::text`) so the comparison survives the `100` → `100.00`
   representation change and compares VALUES rather than formatting. **Both figures cover the 27
   products that existed before `prod_milk` was created on 2026-08-13** — exclude `prod_milk`
   (`WHERE id <> 'prod_milk'`) to reconcile against them, or take a fresh 28-row baseline.
3. **`_prisma_migrations`** — expect all 8 rows **(9 as of Migration D, applied 2026-08-12; the
   documented restore predated D, so it shows 8)**, with their **original** `finished_at`
   timestamps (restored, not re-applied). **Do not run `migrate deploy` to "fix" the history.**
4. **RLS enabled on every public table** (see Database security below) — a dump does restore it,
   but confirm rather than assume; a table left with RLS off is a live security gap.
5. **Sign in through the app.** Connectivity plus a `User` row proves login *should* work; only a
   sign-in proves it does.

### 4. 🔴 BACKUP DISCIPLINE — verify by CONTENTS, never by existence

**Before any migration or destructive database operation, a VERIFIED backup must exist.**

"Verified" does not mean the file is there. It means you opened it and confirmed it holds real
data:

- **Grep the dump for a known real row** — e.g. the customer name `Saif`. If a row you know
  exists is not in the file, the file is not a backup of your data.
- **Confirm it ends with `-- PostgreSQL database dump complete`.** A dump truncated by a dropped
  connection or a full disk looks perfectly normal until you try to restore it.
- **A schema-only dump is NOT a backup.** If there are no `COPY` or `INSERT` data blocks, it
  restores an empty database. Check for them explicitly.

**There is no second safety net.** Supabase **free tier keeps ZERO automatic backups and offers no
point-in-time recovery.** The manual verified dump is the only copy in existence. (This is one of
the reasons for the Pro upgrade at handoff — CHECKLIST #3.)

**The habit that paid for itself:** the backup taken after Migration C was verified by contents
before it was needed. Without it, all 27 products, both real sales, the farmer ledger, the shop
settings and the owner's login row would have been permanently gone.

---

## Database security (READ BEFORE TOUCHING RLS)

**Row Level Security is ENABLED on all 14 tables in `public`, with ZERO policies. This is
deliberate and correct. Do not "fix" it.**

Migration: `prisma/migrations/20260803000000_enable_rls/`.

### Why it looks wrong but isn't

Supabase exposes every `public` table through PostgREST, and **the anon key is public by
design** — it ships to browsers. Without RLS, anyone with that key could read or write every
customer, sale and payment row at `https://<ref>.supabase.co/rest/v1/...` with no login.

RLS with no policies = **default deny** for `anon` and `authenticated`. That is the entire
point. The usual warning that "enabling RLS without policies blocks all access" does not
apply here, because nothing in this app authenticates as those roles:

- The app does **not** use Supabase Auth. Auth is NextAuth v5 + the `User` table (see Authentication).
- The app does **not** use the anon key or the Supabase Data API. `@supabase/supabase-js` is
  installed but unused for data access.
- **All** database access is Prisma, over a direct Postgres connection, as the `postgres` role.
  That role has `rolbypassrls = true` **and** owns all 14 tables — two independent reasons RLS
  never applies to it. Verified: reads, creates, updates, deletes and FK-joined writes all pass
  with RLS on.

### Rules

- **Do NOT create `anon` or `authenticated` policies.** There is no legitimate caller for them.
- **Do NOT disable RLS**, and do not drop the migration above.
- **Do NOT add `FORCE ROW LEVEL SECURITY`** — that would make RLS apply to the table owner too
  and would break Prisma. (`relforcerowsecurity` is 0 on every table; keep it that way.)
- **New tables need the same treatment.** Prisma does not manage RLS, so `prisma migrate` will
  create future tables with RLS OFF. Every migration that adds a table must also add
  `ALTER TABLE public."NewTable" ENABLE ROW LEVEL SECURITY;`, then re-run the Supabase advisors.

### Expected advisor output

`get_advisors({ type: "security" })` reports 14 × `rls_enabled_no_policy` at **INFO** level.

⚠️ **The count moves when tables do, so treat it as "every table", not as the number 14.** It was 18
for months, went to 19 when `ProductUnit` arrived (Migration F), and back to 14 when Migration B
dropped five. Re-verified after that drop: 14 tables, RLS on for every one, FORCE RLS on none.
That is the healthy steady state, not a regression. The thing to watch for is
`rls_disabled_in_public` at **ERROR** level — that means a new table slipped through.

### Still open

`anon` / `authenticated` retain table-level GRANTs on every table in `public` (Supabase's default).
RLS makes those grants useless for reading rows, so this is not a leak — but the
Data API surface still exists. Restricting the exposed schemas / disabling the Data API is a
pending decision for the owner; it would not affect Prisma, which never goes through PostgREST.

---

## API Route Conventions
- Live in `/app/api/`. RESTful naming: `/api/farmers/[id]/deliveries`.
- Always return `{ data, error }` shape.
- Validate every body with zod before touching Prisma.
- Use Prisma transactions for any multi-table write (sales + items, cascade deletes).
- Never expose raw Prisma errors. Map to friendly strings, `console.error` the real one server-side.
- Serialize Decimals to numbers before returning (see Gotcha 2).
- Every route checks the session with `auth()` first; reject unauthenticated with 401.
- `export const runtime = "nodejs"` on routes using Prisma/bcrypt.

### Prefer awaiting Prisma queries in SERIES — but the reason changed in 2026-08-19

**`DATABASE_URL` used to carry `connection_limit=1` against the TRANSACTION pooler, which made a
`Promise.all` actively dangerous: the first query executed and the rest queued for the single
connection, and past ~8 the ones at the back blew the 10s pool timeout.**

```
Timed out fetching a new connection from the connection pool.
(Current connection pool timeout: 10, connection limit: 1)
```

Found in Phase 4b: the customer profile fanned out 12 concurrent queries and 500'd in the browser
while `tsc` and `next lint` were both clean.

**That specific failure is gone** — the app moved to the SESSION pooler with `connection_limit=5`
(see the section below). A small fan-out will no longer deadlock on itself.

**Keep awaiting in series anyway, as the default.** Not because concurrency breaks now, but because:

- the pool is still small, and a wide `Promise.all` can still queue;
- every route in this codebase is written that way, and mixed conventions are how the ones that
  matter get missed;
- **round trips, not concurrency, are the budget** — five queries in parallel still cost five round
  trips of database work, and the fix that actually pays is issuing fewer of them.

So: prefer series, never nest a `Promise.all` inside another, and where a route needs many rows fetch
them ONCE and derive everything from that set. See `getCustomerActivity()` in `lib/receivables.ts`,
which was also fetching every sale twice — once for the ledger and once for the purchases list.

### Client data fetching (GLOBAL — applies to every module, not just beverages)

**TanStack Query uses `networkMode: "always"` (set on both queries and mutations in
`components/providers/query-provider.tsx`) plus a 15s `AbortSignal.timeout` in
`lib/api-client.ts`, so requests fail fast and recover instead of pausing or hanging when
offline. Do NOT revert to the default `networkMode`.**

Both halves are load-bearing and cover different failures:

| Failure | Without the setting | With it |
|---|---|---|
| No connection (`navigator.onLine` false) | Query's default `"online"` mode **pauses** the mutation — `mutationFn` is never called, so there is no request, no error and no toast, and a submit button disabled while pending stays disabled **forever** | Request runs, fails immediately, button re-enables with "Can't reach the server." |
| Connected but stalled | `fetch` never settles, so the catch in `api-client` never runs — same permanent "Saving…" | Aborts at 15s into the existing catch |

Found the hard way in Phase 3.2: the new-sale Save button hung indefinitely offline with no
feedback. Verified fixed in-browser — recovery in ~305ms.

### 🔴 A round trip costs ~96ms — Mumbai, since 2026-08-19

**The database moved to `ap-south-1` (Mumbai) on 2026-08-19.** Measured from the dev machine, 20
samples after warming every pooled connection:

| | Median | Range |
|---|---|---|
| **Mumbai `ap-south-1`** (now) | **96 ms** | 92–110 |
| Seoul `ap-northeast-2` (before) | 226 ms | 205–263 |

⚠️ **Warm every connection before benchmarking.** With `connection_limit=5` the first few queries each
open a new connection and read ~230ms, which looks bimodal and made the first measurement of this
move look like no improvement at all. Fire 3–5 throwaway queries first.

End to end on a production build, same screens: settings 235 → **141 ms**, reports summary 237 →
**135 ms**, sales list ~630 → **339 ms**, customers ~630 → **343 ms**, products ~1,020 → **~490 ms**,
saving a sale ~1,600 → **~1,330 ms**.

The section below records the PREVIOUS correction, which is what made this move worth doing rather
than being swamped by pooler overhead.

#### The earlier correction: it was never 1.1s of distance — 2026-08-19

**This section said ~1.1s for months and blamed the Washington↔Seoul split. The number was real; the
attribution was wrong, and it shaped the architecture.** Nearly a second of it was the **transaction
pooler**, and it was removable.

Benchmarked from the dev machine — same database, same host, same trivial `SELECT 1`, six samples
each:

| Connection | Median per query |
|---|---|
| `:6543` pgbouncer **transaction** pooler + `connection_limit=1` (the old `DATABASE_URL`) | **1,175 ms** |
| `:6543` transaction pooler, no `connection_limit` | 1,116 ms |
| **`:5432` Supavisor SESSION pooler (what `DATABASE_URL` is now)** | **230 ms** |

`connection_limit=1` was NOT the cause — removing it changed nothing. The transaction pooler was
adding ~950 ms to every single query.

**End-to-end, same screens, before → after:**

| | Transaction pooler | Session pooler |
|---|---|---|
| `/api/settings` (1 query) | 1,104–1,158 ms | **231–234 ms** |
| `/api/customers` | 3,209–3,318 ms | **612 ms** |
| `/api/milk/farmers?withBalances=true` | 2,773–3,042 ms | **620 ms** |

**Why session mode is safe HERE, and would not be everywhere.** The transaction pooler exists so that
many concurrent serverless functions can share few Postgres connections. This is a **single-owner
app** — the owner confirmed on 2026-08-19 that only one person ever uses it at a time — so the
concurrency the transaction pooler protects against does not exist. On a multi-user product this
trade would be wrong.

**The remaining 230 ms is real network** — Pakistan to `ap-northeast-2` (Seoul), ~5,000 km. It is the
floor until the database moves; see CHECKLIST #14, which is now about **`ap-south-1` (Mumbai)**, the
nearest region, not about moving the Vercel function.

#### The budget model, restated

**Round trips are still the whole budget — they just cost 230 ms each now.**

| Queries in a request | Roughly |
|---|---|
| 3 (a normal screen) | ~0.7s |
| 12 (one sale save) | **~2.9s — measured** |
| 18 | ~4.1s |

**A sale save was 9 sequential round trips; it is 7 now** (~1.6s), measured by counting
`prisma:query` lines in the dev log for one real save. Two cuts, both only safe AFTER the pooler
change:

- **The customer check and the product load run CONCURRENTLY.** They are independent, and
  `connection_limit` is 5 now rather than 1, so a `Promise.all` of two is genuinely parallel instead
  of queueing. −1 trip.
- **The sale's create returns the full detail** instead of `select: { id: true }` plus a
  `findUniqueOrThrow` after COMMIT. That split cost two extra round trips outside the transaction to
  avoid holding a lock during a join — a trade priced at 1.1s per trip, which no longer holds. −2.

**The sales LIST went 4 trips to 2** the same way: it was `$transaction([findMany, count])`, whose
BEGIN and COMMIT were two of the four. 764ms → 245ms.

⚠️ **`relationJoins` was tried and removed — it changed NOTHING.** Prisma 6 already collapses a
nested `select` into one statement with JSON aggregation. The four-queries-per-product fan-out that
motivates that flag comes from `include`, which no hot path here uses. See the note in
`prisma/schema.prisma`; do not re-enable it hoping for a speed-up.

**What is left in a save is the transaction itself** — BEGIN, the stock update, two INSERTs, the
detail select, COMMIT. Prisma's interactive transactions cost one round trip per statement, so that
is the floor without rewriting the write as raw SQL. **At 230ms it is ~1.6s; from Mumbai it would be
~350ms.** The region is now the biggest remaining lever, not the query count.

The old lessons still hold and are still the technique:

- **Collapse independent aggregates into ONE statement.** Five `prisma.aggregate` calls over five
  tables became one `SELECT (subquery), (subquery), …`. See `getReportSummary` in `lib/reports.ts`.
- **Don't compute the same thing twice.**

⚠️ **Some of those collapses were bought at the price of readability** — hand-written SQL where
Prisma would have read better — because a round trip cost 1.1s. At 230 ms that trade is worth
revisiting; do not add MORE hand-rolled SQL on the old justification without re-measuring.

### Structural sharing: a refetch that changes nothing keeps the SAME object reference

**Any screen that seeds local form state from server data with
`useEffect(..., [query.data])` can silently display a value that is not what is stored.**

TanStack Query uses structural sharing: when a refetch returns data deeply equal to what it
already held, it keeps the **existing reference**. The effect's dependency never changes, so
the reseed does not run and whatever the user typed stays on screen as if it had been saved.

Found in Phase 5 browser testing. Quick entry never deletes, so blanking a farmer's litres
and saving leaves the stored delivery untouched — the refetch returned identical data, the
box stayed empty, and the grid showed "no delivery" next to a delivery that still existed.
It type-checked and linted clean; only the browser showed it.

Fix used in `components/milk/QuickEntryGrid.tsx`: a `seedVersion` counter bumped in the
mutation's `onSuccess` and included in the effect deps, forcing a reseed from the server
after every save. **Do not key such an effect on `dataUpdatedAt`** — that also fires on
background/window-focus refetches and would wipe half-typed input mid-entry.

---

## Environment Variables
```env
DATABASE_URL=     # Supabase SESSION pooler, port 5432 (?connection_limit=5)
                  # NOT :6543 — the transaction pooler adds ~950ms per query here.
                  # 🔴 PERCENT-ENCODE THE PASSWORD — see the gotcha below.
DIRECT_URL=       # Same session-pooler host. NOT db.<ref>.supabase.co, which does
                  # not resolve from this network (confirmed twice: Aug 12, Aug 19).
DIRECT_URL=       # Supabase direct connection (for migrations)
NEXTAUTH_SECRET=  # random 32+ char string
NEXTAUTH_URL=     # http://localhost:3000 dev, production URL on Vercel
```

---

## MCP Tools
| Tool | Purpose |
|---|---|
| Supabase MCP | Inspect schema, run queries, verify tables directly |
| Context7 MCP | Pull fresh docs for Next.js, Prisma, shadcn, NextAuth, Supabase before coding |

**Rule: before writing any API route or Prisma query, run `use context7` for current Prisma/Supabase docs. Before any auth work, pull current NextAuth v5 docs.**

**Context7 is BACK UP as of 2026-08-10** (it was down 3–9 Aug, 8+ consecutive sessions). Verified
this session with a live `resolve-library-id` call.

**Pin Prisma lookups to the v6 branch.** Context7 serves v7 by default, which does not apply here
(see the Prisma version guardrail). `/prisma/prisma` exposes **`__branch__6.19.x`** and `6.19.2` as
selectable versions — request one of those rather than reading v7 docs and filtering mentally.
`/prisma/prisma/__branch__6.19.x` is the one to use.

The `node_modules` fallback in the Tech Stack section still stands and is still the stronger source
for "what will actually run at the pinned version". **Say which source you used** either way.

---

## Deployment posture (DECIDED — do not re-litigate each session)

**Vercel plan: stay on Hobby for the whole build phase. Deploy to it freely.**
No client is using the app and there is no real business data, so Hobby is fine and no
upgrade is pending work. Do not raise it as a blocker on every deploy.

**Upgrade to Vercel Pro + Supabase Pro at CLIENT HANDOFF — event-triggered, not date-triggered.**
The trigger is *the client starting to enter real records and rely on the app*. Hobby forbids
commercial use, and the free Supabase tier keeps zero backups.
**→ PRE-HANDOFF CHECKLIST item 3.** Not tracked here.

### ⚠️ HANDOFF INFRA ITEM — the database is in the wrong region

Supabase sits in **`ap-northeast-2`** (Seoul), ~5,000 km from Pakistan, and the production function
in **`iad1`** (Washington DC) is further still. **Measured at 230 ms per round trip** from the dev
machine after the pooler fix of 2026-08-19.

⚠️ **The old figure here was ≈1.07s and it was blamed entirely on distance. That was wrong** — ~950 ms
of it was the transaction pooler, and it is gone. What remains is real geography. The nearest region
is **`ap-south-1` (Mumbai)**.

**→ Both moves, and why the database one matters more than the function one: PRE-HANDOFF CHECKLIST
item 14.**

### Deployment reality check — read before trusting a green deploy

- **Preview deploys were BUILD CHECKS ONLY until 8 Aug 2026.** Auth.js inferred the session
  cookie name from the resolved auth URL, and `NEXTAUTH_URL` is set for Production only — so
  preview issued `authjs.session-token` while the edge middleware looked for
  `__Secure-authjs.session-token`. You could sign in, `/api/auth/session` would return your
  user, and every page still 307'd to `/login` and every API call still 401'd. **Every "preview
  READY" in Phases 1–7 proved only that the build compiles.**
  **Fixed** by pinning `useSecureCookies` in `lib/auth.config.ts` (see the comment there);
  preview now returns 200 on gated routes with a real session. Behavioural verification is
  still primarily the local browser pass, but preview is now usable for it too.
- **Production is LIVE with the full app since 2026-08-19** — deployed at the owner's explicit
  request. ~~Every route from Phases 2–7 returns 404 there~~ no longer true; that described the
  state when only preview deploys had ever been run.

  **Live at `https://muneeb-inventory-system.vercel.app`**, functions in `bom1` (Mumbai) beside the
  database, PWA installable, auth gating verified (`/login` 200, `/sales` 307 signed out).

  ⚠️ **Live is NOT the same as handed over.** These are still open and are what "go-live" means:
  the data reset (#2), the owner's real shop details (#2b), and the Pro upgrades (#3 — **Hobby
  forbids commercial use**, so the plan must change before this is a business's working tool).

  **How the Vercel→Mumbai connection was verified**, since every DB-touching route needs a login:
  the runtime errors showed `CredentialsSignin` and nothing else. That error can only be reached
  AFTER the user lookup and password compare have run, so the database was reached — an unreachable
  one produces `PrismaClientInitializationError` instead. A failed sign-in is a useful probe.

### Live project
| | |
|---|---|
| Production URL | `https://muneeb-inventory-system.vercel.app` |
| Vercel project | `muneeb-inventory-system` |
| Scope | `saifurrehmanch104-5326s-projects` (personal, Hobby) |

Production env vars: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET` (encrypted, Preview +
Production) and `NEXTAUTH_URL` (Production). **`VERCEL_TOKEN` is CLI auth only — never add
it as a project env var.**

Note: a project's FIRST CLI deployment is assigned to production automatically, even without
`--prod`. Only relevant once, but it surprises people.

### Workflow rule: deploys are free, migrations are deliberate
- **Deploys** to Hobby may be run without asking.
- **Migrations are NEVER automatic.** Do not add `prisma migrate deploy` to the build script,
  and do not run migrations without confirming first. `postinstall` and the build command run
  `prisma generate` only.

### PWA (Phase 8)
Manifest `start_url` and `scope` must both be **`"/"`** — the app is served at the root.
**→ PRE-HANDOFF CHECKLIST item 11** for the full item and why a wrong value only breaks after
install.

### Still true regardless of plan
- **Supabase free tier pauses after 7 days and keeps zero backups** → CHECKLIST item 3.
- Prisma on Vercel: `prisma generate` runs in BOTH `postinstall` and the build command.
  Vercel caches dependencies, which can skip `postinstall` and ship a stale client — the
  build-command copy is the guard. Pooled `DATABASE_URL` at runtime, `DIRECT_URL` for
  migrations only.

---

## Local development notes

**Two dev servers running at once will corrupt `.next` and 404 every client chunk.**

*Symptom:* the page renders (server HTML is fine) but nothing is interactive — no hydration,
buttons do nothing, forms fall back to native submits. The console shows repeated
`Failed to load resource: 404`, and the network panel shows `main-app.js`,
`app-pages-internals.js` and every `app/**/page.js` returning **404** while `webpack.js`
returns 200. It looks like an application bug and is not one.

*Cause:* a hard-killed `next dev` can leave port 3000 held, so the next `npm run dev` starts
on **3001** and writes to the same `.next`. Two servers, one build directory. Whichever one
you have open in the browser is now serving chunks the other overwrote.

*Fix:* kill everything listening on 3000/3001, delete `.next`, start exactly ONE server.

```powershell
Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```
```bash
rm -rf .next && npm run dev   # confirm it says "Local: http://localhost:3000", not 3001
```

Always check the port the server actually bound to before blaming the app. Not a code
defect — an operational trap that cost real time in Phase 5.

### Recreating `.env` — trim the Vercel pull, or auth breaks in a way that looks like a bug

`.env` is gitignored, so a fresh checkout has none and **every request logs
`MissingSecret` while the app still renders `/login` perfectly happily** — sign-in just silently
never establishes a session. `vercel env pull` is the way back (the project is linked, and
`NEXTAUTH_SECRET` / `DATABASE_URL` / `DIRECT_URL` are all on Preview):

```bash
vercel env pull .env --environment=preview --yes
```

**Then delete everything it added except those three, and add
`NEXTAUTH_URL=http://localhost:3000`.** The pull also writes **`VERCEL=1`**, and
`useSecureCookies: process.env.VERCEL === "1"` in `lib/auth.config.ts` then issues a `Secure`
session cookie that the browser **drops over plain-http localhost** — you sign in, get a 200, and
are still signed out. Pull into `.env`, not `.env.local`: `.env.local` holds the Vercel OIDC token
and Next reads both.

---

## Development Phases

| Phase | Scope | Status |
|---|---|---|
| 1  | Scaffold + Prisma schema + split-config auth + Vercel deploy | ✅ Done |
| 2  | Category & product manager (CRUD + inline price editor) + seed | ✅ Done |
| 3  | Beverages module (multi-item sales, list, customer ledger) | ✅ Done |
| 4  | Bakery module (mirrors beverages) | ✅ Done |
| 4b | Customers hub + receivables (payments, outstanding balances) | ✅ Done |
| 5  | Milk shop: farmers, deliveries, purchases, quick-entry, milk sales | ✅ Done |
| 6  | Farmer net-balance ledger + all-farmers balance sheet | ✅ Done |
| 7  | Reports dashboard + charts + CSV export | ✅ Done |
| 8  | Polish: mobile nav, states, a11y, PWA, login POST-only security fix, final validation | ✅ Done |

**Every phase is complete, and so is the unified-sale rework below.** What is left is not
development — it is the handover sitting (the owner's own data and his billing plan). See
`REMAINING-WORK.md`, which is now the handover document rather than a build roadmap.

### The UNIFIED SALE rework — its own track, running alongside Phase 8

The phase table above describes the app as originally scoped. The unified-sale rework is a separate
sequence, and this is where it actually stands. **Full stage-by-stage detail lives in
`REMAINING-WORK.md`; the authoritative status is CHECKLIST #4.**

| Stage | Scope | Status |
|---|---|---|
| Migration A | additive `Sale` / `SaleItem` (+ `moduleKey`, `netLineTotal`) | ✅ applied 2026-08-09 |
| **Migration C** | `SaleItem.quantity` → `Decimal(10,2)` — fractional litres | ✅ applied 2026-08-11 |
| **Migration D** | `Product.stock` → `Decimal(10,2)` (+ 2 scoped code fixes) | ✅ applied 2026-08-12 · `8847fff` |
| **S2** | split milk-sale code out of `lib/milk.ts` (isolate farmer code) | ✅ `9b87dc4` |
| **S3** | unified `POST /api/sales` — beverages + bakery, milk designed-for | ✅ `90e8609` · **21/21** |
| **Milk product + bridge** | `prod_milk` + delivery-to-stock, all 4 delivery paths, reconcile-by-delta | ✅ `cbcd2eb` · **22/22** |
| **S4.1** | `GET /api/sales` · `GET`+`DELETE /api/sales/[id]` (delete RESTORES stock) · hooks | ✅ 2026-08-14 · **20/20** |
| **S4.2** | unified sale SCREEN (`/sales`, `/sales/new`) + unified receipt + receivables bridge | ✅ 2026-08-14 · **13/13 + browser** |
| **S4.3** | **milk cutover** — `/milk/sales` history-only, milk stock AUTHORITATIVE | ✅ 2026-08-14 |
| **S5** | migrate the 2 real sales onto `Sale` / `SaleItem` | ✅ 2026-08-14 · applied + verified |
| **S6** | reporting repoint to `Σ netLineTotal` by `moduleKey` + **per-product visibility** (#20) | ✅ 2026-08-14 · **12/12 + 8/8**, table shipped |
| **S7** | catalog features: cooling charge (#17), billing-time price override (#18) | ⬜ Todo |
| **S8** | multi-unit products — eggs dozen/tray/peti, beverages bottle/pet, one stock pool (#19) | ✅ 2026-08-18 · Migration F · **13/13 + browser** |
| **S9** | remove the old per-module paths, then **Migration B** (dropped 5 tables) | ✅ 2026-08-18 · applied + verified |

**S4 is DONE (S4.1–S4.3, 2026-08-14).** Both of the things it carried are closed: milk stock is
authoritative (the cutover — see the "🥛 Milk stock" section for the one caveat about the opening
number), and `DELETE /api/sales/[id]` restores stock the way the per-module routes always did.
**The unified EDIT/PATCH is the one piece deliberately left open — CHECKLIST #8.**

**Before declaring the project ready for the client, work the PRE-HANDOFF CHECKLIST**, not this
table. Phase 8 is polish; the checklist is everything that must be true at handoff.

### 🔴 The two go-live blockers — *deliberately duplicated here* (one now closed)

> **INTENTIONAL DUPLICATION. Do not "clean this up" to a pointer.** The rest of this file follows a
> strict one-place rule (see the process rule at the top), and these two lines break it **on
> purpose**: they are the items whose cost of being forgotten is unrecoverable, and the phase table
> is where someone looks when they think they are finished. Belt and suspenders. **Everything
> below is a stub — the authoritative write-up, and the status you update, stay in the
> PRE-HANDOFF CHECKLIST.** If these two ever disagree with the checklist, the checklist wins.

| | Blocker | Status | Full item |
|---|---|---|---|
| ✅ | **Login POST-only security fix.** ~~With JS absent the form submits GET and puts the owner's email and password in the URL.~~ Fixed and verified with JavaScript disabled on 2026-08-10. **No longer blocks go-live or Phase 8.** | `[x]` closed | CHECKLIST #1 |
| ✅ | ~~**Data reset before go-live.**~~ **DONE 2026-08-19** — 10 sales, 14 line items, 3 customers, 2 farmers, 3 deliveries and 4 purchases deleted in one transaction against a freshly verified backup. Catalog, settings and owner login kept and confirmed intact. Shop details were already set. | `[x]` closed | CHECKLIST #2 |

(The other go-live blocker — the Vercel Pro / Supabase backup upgrade, CHECKLIST #3 — is not
duplicated here: it is a billing action at handoff rather than something that can be silently
shipped past. Shop details ride along on the data-reset row above rather than taking a third row,
because they are the same "owner's real data replaces our stand-ins" sitting — and a third row
would start diluting the two that matter.)

### Carried-forward notes

- **Phase 1 delivered:** Next.js 14 + Tailwind + shadcn scaffold, Prisma 6 schema (15 tables),
  split-config NextAuth v5 with a live owner login, RLS on every table, the app shell
  (sidebar + mobile bottom nav + shared components), and a deployed Vercel project.
  Live: `https://muneeb-inventory-system.vercel.app`
- **Phase 2 delivered:** catalog API with guarded deletes, the catalog UI at `/catalog`, and
  the seed. Three things Phase 3 inherits:
  - **The catalog is seeded.** 2 categories, 11 sub-categories, 62 products, all at `price 0`
    and `isActive true`. The seed is additive (`upsert` with `update: {}` on deterministic
    ids), so re-running never duplicates or resets an owner-set price — but it WILL recreate
    a seeded product the owner deleted.
  - **A refused delete returns `{ error, blockedBy: [{ id, name, saleCount }] }`.** Consume
    the structured field; never parse the prose. Sale modules must keep this working — the
    guard in `lib/catalog-guards.ts` is the single implementation for all three levels.
    **✅ CLOSED — re-tested against real sale history on 4 Aug 2026 and passed at all three
    levels** (category 409, sub-category 409, product 200 + soft delete). The `blockedBy`
    field was proven to be consumed structurally rather than parsed from the prose: the UI
    renders a per-product sale count that appears nowhere in the sentence. Keep it working; it
    no longer needs re-testing.
  - **`tailwind.config.ts` content globs must include `./lib`.** The `ACCENTS` map in
    `lib/nav.ts` is the only place module accent classes appear as literals; dropping `./lib`
    silently strips them from the CSS and colours fall back to default foreground. This bit
    us once already.
- **Phase 3 delivered:** the beverages sale API (3.1) and UI (3.2) — `/beverages` and
  `/beverages/new-sale`. Four things Phase 4 (Bakery) inherits:
  - **`reconcileSaleLines()` in `lib/sales.ts` is THE price-snapshot implementation.** Reuse
    it; do not re-derive the predicate. Same for `SALE_DETAIL_SELECT` and `loadSaleProducts`,
    which are written generically because BakerySale has the same relation names.
  - **The global TanStack Query settings above are not optional.** See the client
    data-fetching note in API Route Conventions.
  - **The delete-guard 409 / soft-delete re-test is DONE** — run 4 Aug 2026, all three levels
    passed, DB restored to baseline. See the Phase 2 note above. No longer an open item.
  - **Verify UI in a real browser, not on a build.** Phase 3.2 type-checked, linted and built
    green while still carrying three real bugs — one of which trapped the owner with no way to
    recover. The build proves it compiles, nothing more.
- **Phase 4 delivered:** the bakery module — `/bakery`, `/bakery/new-sale`, and
  `/api/bakery/sales`. What later modules inherit:
  - **The sale components are SHARED, in `/components/sales/`**, parameterised by a
    `SaleModule` from `lib/sale-modules.ts` (endpoint, catalog category, accent, copy).
    Milk sales should add a config row, NOT a third copy of the form. If you find yourself
    forking one of these components, that is the signal to parameterise instead.
  - **Query keys are module-scoped** — `["sales", module.key, …]` in `lib/hooks/use-sales.ts`.
    Without the module segment, opening one module's list shows the other's rows from cache.
    Verified behaviourally: 12 samples across rapid switches, no leak.
  - **🔴 A size/tier/shape suffix is shown only when the NAME does not already say it.**
    `composeProductDetail()` in `lib/catalog-display.ts` is the ONE implementation, used by the
    receipt (`lib/receipt.ts`) and the sale line list
    (`components/sales/UnifiedSaleLineItems.tsx`). Both used to append the attributes blindly and
    printed **`Biscuits Simple  Simple`** and **`Pepsi 1L  1L`** — on a customer's bill, where the
    repeat reads as a second product. Checked against the catalog: **all 69 products carrying a
    size, tier or shape duplicated it**, because the seed names them that way. The suffix is still
    BUILT, not deleted — a product genuinely named `Russ` still gets `Russ · Large · Circle`. It is
    the DUPLICATION that was wrong. Fixed 2026-08-20; same family as the unit rule below.
    ⚠️ Note the trap that hid twelve of them: the receipt title-cased `half_litre` into
    `"Half Litre"`, which then failed to match a name reading `0.5L` and printed anyway. The shared
    helper uses `formatSize`, which maps it to `"0.5L"`.
  - **A unit suffix is shown only when the unit ADDS information.** `SELF_EVIDENT_UNITS` in
    `lib/sale-catalog.ts` suppresses "bottle"/"piece"; eggs keep "Quantity (cottons)" because
    a bare "3" is genuinely ambiguous. It is a property of the unit, not the module — do not
    add per-module branching.
  - **Picker labels use every attribute a product carries** (size, qualityTier, shape,
    discount) and fall back to the brand when it carries none. Composing from size+discount
    alone made `Biscuits Premium`/`Simple` and all four Russ variants indistinguishable.
- **Phase 4b delivered:** the customers hub + receivables — `/customers`, `/customers/[id]`,
  and the `/api/customers/*` tree. Three things that carry forward:
  - **`lib/receivables.ts` is THE receivables calculation**, the way `reconcileSaleLines` is
    THE price snapshot. `outstanding = billed − paid`, billed spans beverages + bakery +
    **milk**. Reports and dashboards must call it, not re-derive it.
  - **MilkSale is already counted**, ahead of its Phase 5 UI. Empty table contributes 0, so
    when milk sales start being recorded the balances are correct with no change here.
  - **A customer is never hard-deleted** — soft only, like a Product with sale history.
- **Phase 5 delivered:** the milk shop — `/milk`, `/milk/quick-entry`, `/milk/farmers/[id]`,
  `/milk/sales`, and the `/api/milk/*` tree. **No migration was needed** — all four
  milk tables already existed. Zero existing files were modified. What Phase 6 inherits:
  - **`lib/milk.ts` is THE farmer net-balance calculation**, the way `lib/receivables.ts` is
    THE customer balance. `netBalanceOwed = milkValue − purchases`. Phase 6's balance sheet
    must call `getFarmerBalances()` (a FIXED two queries for all farmers) and
    `summariseFarmerBalances()`, not re-derive either — and never one query per farmer.
  - **THE SIGN IS INVERTED versus customers, and this is the module's sharpest trap.**
    Customer: positive `outstanding` = they owe the owner → **rose**. Farmer: positive
    `netBalanceOwed` = the OWNER owes the farmer → **emerald**. Both positive, opposite
    directions. Only `lib/milk-display.ts` decides colour/wording; never test the sign at a
    call site, and never reuse the customer helpers on a farmer.
  - **Debts and advances are never netted.** `summariseFarmerBalances` reports
    `totalOwedToFarmers` and `totalAdvanced` separately: one farmer owed 5,000 and another
    5,000 ahead would net to "nothing to pay" while the first still needs paying in cash.
  - **`lib/milk.ts` imports Prisma, so it is SERVER-ONLY.** Client components use
    `lib/milk-display.ts` (dependency-free). Same split as receivables/receivables-display.
  - **null litres ≠ 0 litres.** `morningLiters`/`eveningLiters` are null when that session
    did not happen. `serializeLiters()` preserves it and `formatSessionLiters()` renders "—".
    Never coerce to 0 — a skipped morning would read as a farmer who came empty-handed.
  - **One delivery per farmer per Karachi DAY, enforced in the route, not the DB.** There is
    no unique constraint (that would need a migration). The POST returns 409 with
    `existingDeliveryId`; quick entry finds the day's row and UPDATES it, which is how the
    evening pass lands on the same row as the morning.
  - **Quick entry never deletes.** A blanked row comes back in `clearedButKept` and the UI
    warns; deletion stays an explicit action with a confirm dialog.
  - **`components/shared/ConfirmDialog.tsx`** is the new generic destructive-action confirm.
    `DeleteSaleDialog` was deliberately left alone — it is shipped and verified.
- **Phase 6 delivered:** the all-farmers balance sheet at `/milk/balances`, plus the hub link.
  **No new API route, no new query, no new arithmetic** — it consumes the existing
  `/api/milk/farmers` response, which
  already carried both the per-farmer balances and the summary. What carries forward:
  - **The fixed-query claim is now MEASURED, not just asserted.** `getFarmerBalances()` issues
    **exactly 2 SQL statements for 2 farmers and for 7** — two `SUM … GROUP BY` aggregates.
    Proven by instrumenting the real singleton (`lib/prisma.ts` caches it on `globalThis`
    outside production, so pre-seeding it with an event-logging client measures the real code
    path). Re-run that if you ever suspect an N+1 has crept in.
  - **The per-farmer ledger already existed** — the farmer profile's Ledger tab renders
    `buildFarmerLedger` with a running balance. Phase 6 confirmed it and did NOT rebuild it.
  - **No date-range filter on the ledger, deliberately.** A running balance filtered to a date
    window is wrong unless it carries an opening balance forward; the first row would start
    from zero and every figure below it would be understated. If a date filter is ever wanted,
    it has to compute an opening balance too — it is not a cosmetic addition.
  - **Retired farmers who still have a balance are INCLUDED everywhere money is totalled**
    (`includeInactive: true`), because retiring someone does not settle what they are owed.
    Retired *and* settled are hidden — finished business.
    **The milk hub and the balance sheet pass the SAME options to `useFarmers`, on purpose.**
    They therefore share one TanStack cache entry: they are not two agreeing calculations,
    they are the same response rendered twice, and cannot drift. ✅ The hub tile previously
    fetched active-only and understated the payable (17,000 vs 21,000 on the Phase 6 fixture);
    fixed and browser-verified — both now read 21,000.
    Two display rules follow from that shared query, and should be kept:
    the hub's farmer LIST stays active-only (it is the working list of people who deliver,
    and the tile says "includes N retired" when relevant), and any per-screen count must be
    derived from the set that screen actually shows — the balance sheet's context line counts
    the farmers ON the sheet, not every farmer fetched, or it reads "7 farmers" above 6 rows.
- **Phase 7 delivered:** the reports dashboard at `/reports`, `/api/reports/{summary,trend,
  top-products,export}`, `lib/reports.ts`, `lib/csv.ts`, and Export CSV buttons on six
  screens. What carries forward:
  - **`lib/reports.ts` owns the NEW aggregates only** (revenue per period, top products).
    Balances are delegated: `getTotalOutstanding()` lives in `lib/receivables.ts` and
    `getAllFarmerTotals()` in `lib/milk.ts`, so the reports figures are the SAME calculation
    the customers hub and balance sheet use. Verified equal in-browser: 14,100 and 13,000 on
    all three screens.
  - **Karachi day bucketing is done in SQL**, not in JS:
    `date_trunc(unit, ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi')`, returned
    via `to_char(...,'YYYY-MM-DD')` so a naive timestamp is never re-interpreted by the
    driver. Verified on the live DB before use, and end-to-end: a 1am PKT sale counts as that
    Karachi day, an 11pm-the-night-before sale does not.
  - **`prisma.groupBy` cannot group by an expression**, which is why the trend is raw SQL.
    The alternative — a query per day — is the trap this phase was told to avoid.
  - **CSV lives in `lib/csv.ts`** and is RFC 4180: values containing a comma, quote or
    newline are quoted, internal quotes doubled, CRLF endings, UTF-8 BOM so Excel doesn't
    mangle non-ASCII names. Verified with a customer literally named `ZZ_TEST_Ali, Sons` and
    a multi-line note — columns held. The formula guard skips `-` deliberately so negative
    money stays numeric.
  - **The export route does NOT return the `{ data, error }` envelope on success** (it
    returns a file) but DOES on failure, and `useExportCSV` checks the content type before
    saving — otherwise a 400 gets written to disk as a `.csv` full of JSON.
- **Phase 8 tasks (PWA, touch targets, date locale, on-device mobile) → PRE-HANDOFF CHECKLIST**
  items 11, 10, 12, 13. Not restated here; the checklist is the only place they are tracked.
- **`Product.discountPercent` is GONE — column dropped 2026-08-10, CHECKLIST #9 closed.** The rule
  it existed to protect now holds structurally: a sale line's discount is the line's own
  snapshotted `discountPercent`, and there is no product discount left to read by mistake. The
  removal took **13 files**, not the 6 that item predicted — the four it missed were
  `lib/hooks/use-catalog.ts`, `components/catalog/ProductDialog.tsx`,
  `components/catalog/CatalogManager.tsx` and, the one that would have bitten,
  **`prisma/seed.ts`**, which still wrote the column and would have broken the next seed run after
  a green migration. Lesson worth keeping: **grep for writers as well as readers before dropping a
  column** — the seed is not in any component tree and does not show up in a UI-shaped search.
- **~~THE BEVERAGES/BAKERY SALE `PATCH` IS FULLY IMPLEMENTED AND HAS NO UI~~ — RESOLVED, and worth
  keeping as a lesson.** For weeks this note existed to stop someone deleting a complete,
  server-verified `PATCH /api/{beverages,bakery}/sales/[id]` that no screen could reach. The right
  call was made twice over: it was NOT deleted as cruft, and it was NOT given a per-module edit
  screen — that screen would have been built against a structure the unified rework was about to
  replace. **S9 deleted the routes along with everything else per-module**, and the behaviour they
  proved (stock reconciled BY DELTA: 12 → 8 frees 4) lives on in `reconcileSaleLines` /
  `computeStockDeltas`, reached through the unified edit screen.
- **The one deliberate data reset before go-live → PRE-HANDOFF CHECKLIST item 2** (a blocker).
  The habit that supports it stays here: **every verification pass `ZZ_TEST_`-scopes what it
  creates and removes only that**, precisely so the reset can be one decision at the end rather
  than a series of small ones. Keep doing that.
- **Context7 → CHECKLIST, closed items.** It reconnected on 2026-08-10. The `node_modules`
  fallback earned its keep while it was out — the discount migration SQL came from the real Prisma
  6 CLI via `migrate diff`, `Prisma.Decimal`'s `ROUND_HALF_UP` default was confirmed by executing
  it, and the Recharts animation bug in batch 1 was found by reading
  `node_modules/recharts/es6/cartesian/Line.js` — and it remains the sanctioned source when the
  question is "what will actually run at the pinned version". See MCP Tools for the v6-branch pin.

---

## ✅ PRE-HANDOFF CHECKLIST — THE single source of truth for what is left

> 🗺️ **A stage-by-stage roadmap of the remaining unified-sale work (S4–S9), the catalog features, and
> go-live sequencing lives in `REMAINING-WORK.md` in the repo root.** That file is the *plan*; this
> checklist remains the *status*. If they disagree, this one wins.

**Every open item lives HERE and nowhere else.** These were previously scattered across the
Authentication section, the Deployment posture section and the carried-forward notes; those places
now hold only the technical rule and a pointer back to this checklist. **If you close an item,
close it here.** If you find an open item somewhere else in this file, it is a leak — move it in.

The failure this section exists to prevent: **a BLOCKER getting lost in prose.** Two of these
cannot be handed to the client under any circumstances, and one of them is a credential exposure.

**Re-verified against the repo and the live database on 2026-08-19.** Status is what is TRUE now,
not what was planned.

**Everything in this checklist is now closed except four items**, and none of the four is
development work:

| | Item | |
|---|---|---|
| ✅ | ~~**#2** data reset~~ | **CLOSED 2026-08-19** |
| 🔴 | **#3** Vercel Pro + Supabase Pro | **THE LAST GO-LIVE BLOCKER** — a billing action |
| 🟡 | **#13** on-device check on a real phone | the last untested surface |
| ⚪ | **#15** Supabase Data API surface | the owner's decision, not a leak |

Legend: `[ ]` open · `[~]` in flight · `[x]` closed · **[BLOCKS GO-LIVE]** = do not hand over

---

### 🔴 Blockers

#### `[x]` **1. ~~[BLOCKS GO-LIVE]~~ Login POST-only security fix — CLOSED 2026-08-10**

**Status: fixed, verified with JavaScript disabled, no longer blocks go-live or Phase 8.**

Was: with the client bundle absent or unhydrated the login form submitted **natively**, and with no
`method` on the `<form>` the browser defaulted to **GET**, putting the credentials in the query
string — `/login?email=…&password=<the actual password>` — where they reach browser history, server
and proxy access logs, and any onward `Referer`. Found during Phase 5 mobile verification
(2026-08-08) while every client chunk was 404ing from a corrupted `.next`.

**Shipped:** `method="post"` + `action="/api/auth/no-js-login"` on the form, and a route that
exports POST only (GET/HEAD/PUT → 405), with an Origin/Referer CSRF check and server-side
`callbackUrl` sanitising. **→ The rules that must not be undone are in the Authentication
section**, not here.

**Verified with JS genuinely disabled** — script execution killed at document start, confirmed by
12 script tags present and none executed. The submit produced
`POST /api/auth/no-js-login` with `email`/`password` in the **request body**, a bare URL with no
query string, `303` to the callback target, and a `Set-Cookie` session; the address bar afterwards
read `http://localhost:3000/beverages` with no credentials anywhere. Wrong password → 
`/login?error=CredentialsSignin` rendering "Incorrect email or password." server-side. JS-on flow
re-verified unchanged (still `/api/auth/callback/credentials`, no console errors, bad password
rejected in place, good password lands on `/`).

#### `[x]` **2. Data reset — DONE 2026-08-19. No longer blocks go-live.**

**Run once, deliberately, with the delete set confirmed by the owner first** — exactly as this item
always demanded. `scripts/data-reset.ts` is the implementation; it **dry-runs by default** and only
writes with `--confirm`, because a script whose destructive path is the one you get by typing its
name is a script that eventually runs by accident.

**Deleted** (one transaction, so a half-applied reset could not leave orphaned money):

| Table | rows |
|---|---|
| `Sale` | 10 |
| `SaleItem` | 14 (cascade) |
| `Customer` | 3 |
| `CustomerPayment` | 0 |
| `Farmer` | 2 |
| `MilkDelivery` | 3 |
| `FarmerPurchase` | 4 |

**Kept, and verified kept rather than assumed:** `User` 1 · `Settings` 1 · `Category` 3 ·
`SubCategory` 20 · `Product` 75 · `ProductUnit` 60. The script asserts this itself and prints
`🔴 CATALOG CHANGED` if any of those counts moved.

**The backup that made it safe:** `E:/Carreer_efforts/pre-reset-backup8-20260819-1635.sql`, verified
**BY CONTENTS** — ends with `-- PostgreSQL database dump complete`, contains "Mateen Traders" and the
owner's login row, carries no `DROP`/`TRUNCATE`, and its `COPY` counts matched live exactly.

> ⚠️ **Every pre-existing backup was STALE and would have been the wrong safety net.** `backup7.sql`,
> taken the same day, held 5 sales and 1 customer against a live database of 10 and 3 — the owner had
> kept using the app after it was taken. **Take a fresh dump immediately before the reset and compare
> its row counts to live; do not reach for the most recent file on disk.**

**Verified after:** every screen renders its empty state cleanly with no console errors — dashboard
"No sales recorded today yet", `/sales` "No sales yet", `/customers` "No customers yet", `/milk`
"No farmers yet", `/reports` all Rs. 0. `getTotalOutstanding()` and `getAllFarmerTotals()` return 0
on an empty database rather than throwing.

**Stock and prices were LEFT AS THEY WERE, at the owner's explicit instruction** ("leave the stock as
is"). So 73 of 75 products remain at Rs. 0, two carry test prices (Big Apple 0.5L at 120, 7Up 0.5L at
250), and every product keeps the seed placeholder of 100. The script has `--zero-stock` and
`--zero-prices` flags if that is ever wanted; neither was used.

##### 🔴 ONE LOOSE END THE RESET CREATED: `prod_milk.stock` is 4,050 L with an EMPTY ledger

Milk stock is **derived** — deliveries add to it, sales subtract. The reset deleted every delivery
but left the stock figure alone, so the catalog now claims 4,050 litres that no record accounts for.
The till will happily sell them.

This is not a bug in the bridge; it is the consequence of clearing the ledger without clearing the
figure it had produced. **The owner sets the true opening litres at handover**, the same as every
other shelf count — the escape hatch is the catalog's inline stock editor, which SETS the value
outright. Until he does, treat that number as meaningless rather than as inventory.

#### `[x]` **2b. Owner's real shop details — DONE 2026-08-19. No longer blocks go-live.**

**The owner has saved his own details.** Verified against the database rather than the screen, which
is what this item always insisted on:

```
shopName     = "Mateen Traders"
configuredAt = 2026-08-19T06:53:57Z        -- non-NULL: he has saved at least once
```

The placeholders are gone, so the receipt and the farmer statement both print a real letterhead.
**#2 (the data reset) is still open and still blocks** — these two used to sit together as one
handover sitting, and only this half is finished.

The rules below are kept because they are still load-bearing for anyone editing Settings.

`Settings` seeds with **deliberately unmistakable placeholders** —
`SET SHOP NAME IN SETTINGS`, `SET PHONE IN SETTINGS`, `SET ADDRESS IN SETTINGS`. That is a design
choice, not laziness: a receipt printed before setup must be **obviously unconfigured, never
plausibly real**. A friendly placeholder like "Your Shop Name" would print a receipt that looks
finished and is wrong — the failure mode we are buying our way out of is a customer walking away
holding one.

##### 🔒 Two decisions here are LOAD-BEARING. Do not soften either one.

**1. The placeholders stay jarring, and they are defined ONCE.**
`SETTINGS_PLACEHOLDERS` in `lib/settings-display.ts` is the single constant; the seed INSERT in the
migration must match it exactly. Do NOT "improve" the copy to something friendly — the whole value
of the string is that it cannot be mistaken for a real shop name on a printed receipt.

They behave differently in the two places they surface, and that asymmetry is intentional:

| Where | Behaviour |
|---|---|
| **The Settings form** | Treated as EMPTY — the input renders blank with the sentinel as its `placeholder` attribute, plus a rose warning banner. Pre-filling them would let "fix the name and save" silently promote the untouched phone sentinel into a real value |
| **The receipt** | Printed verbatim, shouting |

The server also **rejects a submitted placeholder** as a backstop
(`lib/validations/settings.ts`). Browser-verified 2026-08-10.

**2. NO FORMAT VALIDATION on phone or address. Only trim + a max length.**
These are the owner's own contact details, entered once, printed on his own receipt. There is no
standard format — two numbers, a landline plus a mobile, an extension, an address written however
his customers recognise it. **A format check is far more likely to reject something valid than to
catch a real error**, and a real error is one he sees on his own receipt and fixes in thirty
seconds. A phone regex would be a stranger telling a shop owner his own phone number is wrong.

Caps are **32 / 60 / 200** (name / phone / address) and exist only so the receipt layout survives —
see **Receipt printing** in the Design System for where the numbers come from. Two of them have a
reason that must not be lost:

- **`shopName` = 48** is not a taste judgement, it is one line of an 80mm receipt
  (`RECEIPT_LINE_CHARS`). **It was 32 until 2026-08-20 and moved by itself** when the printer was
  confirmed as 80mm and the constant changed — which is the whole point: **never edit this cap
  directly.** Change `RECEIPT_LINE_CHARS` and the cap, its validation message and the Settings
  form's helper text all follow.
- **`shopPhone` = 60, and MULTIPLE NUMBERS ARE ALLOWED as free text.** Owners routinely list two.
  `0300-1234567 / 042-35678901` is already 27 characters, so the earlier 30 would have rejected an
  ordinary two-number listing — the same false rejection, arriving through a length check instead of
  a regex. **Do not parse, split, or normalise the numbers into separate fields either**; that is
  format enforcement wearing a data-model hat.

Strictness belongs in the money maths, not in free-text contact details.

**The check is exact, so run it rather than eyeballing the screen:**

```sql
SELECT "configuredAt", "shopName" FROM "Settings" WHERE id = 'app';
```

`configuredAt IS NULL` means the owner has never saved his details — **not go-live ready**, whatever
is on screen. The column records the fact directly rather than string-matching the placeholder text,
which would silently stop detecting anything the day someone edits the placeholder wording.

The Settings screen must also **visibly flag placeholder state** so the owner sees it without being
told, and the receipt is not the first place it shows up.

#### `[ ]` **3. [BLOCKS GO-LIVE] Vercel Pro + Supabase backups at handoff**

**Status:** open, event-triggered. **The trigger is the client starting to enter real records and
rely on the app** — upgrade *before* that moment, never after. Not date-triggered; do not raise it
as a blocker on ordinary build-phase deploys.

- **Vercel Pro.** Hobby **forbids commercial use** — once this is a live business tool, Hobby is a
  terms violation, and enforcement would hit the system the client runs their books on. Pro also
  raises function duration/size limits and concurrency, which are not things to discover under live
  load.
- **Supabase Pro (~$25/mo).** The free tier **pauses after 7 days of inactivity and keeps ZERO
  backups.** Do not ship a business's money records on a zero-backup tier. Minimum acceptable
  alternative: a scheduled keep-alive ping **plus** a weekly database export — Pro is the better
  answer.

---

### 🟠 In flight — the unified sale rework is HALF DONE

Not blockers to the app *working* (it runs entirely on the old tables), but it must be **finished
or deliberately abandoned** before handoff. Leaving it half-done hands over two parallel sale
schemas, one of them empty.

#### `[x]` **4. Unified `Sale` build — COMPLETE 2026-08-18 (S9)**

Every part of it shipped: the API (S3, S4.1), the till and receipt (S4.2), the milk cutover (S4.3),
the data migration (S5), reporting (S6), the edit UI (#8), and finally S9, which deleted the
per-module path it was replacing. **Migration B is written but not applied** — see #5.

The record below is kept as-is; it is the history of how the stage was worked.

**Shipped:**

| | What | Evidence |
|---|---|---|
| ✅ | **Migration C** — `SaleItem.quantity` → `Decimal(10,2)` | applied 2026-08-11 |
| ✅ | **Migration D** — `Product.stock` → `Decimal(10,2)` | applied 2026-08-12, commit `8847fff` |
| ✅ | **S2** — milk-sale code split out of `lib/milk.ts` | commit `9b87dc4` |
| ✅ | **S3** — unified `POST /api/sales` (beverages + bakery; milk designed-for) | commit `90e8609`, **21/21 tested** |
| ✅ | **Milk product + delivery-to-stock bridge** | commit `cbcd2eb`, **22/22 tested** |
| ✅ | **S4.1** — `GET /api/sales`, `GET`+`DELETE /api/sales/[id]`, client hooks | 2026-08-14, **20/20 tested** |

**What REMAINS for this item:**

1. ~~The unified sale SCREEN~~ ✅ **SHIPPED in S4.2** — `/sales`, `/sales/new`,
   `/receipt/sale/[id]`, and the receivables bridge. **Reports and the CSV exports followed in S6**,
   so a till bill now appears in every figure.
2. ~~The milk cutover~~ ✅ **SHIPPED in S4.3**, and finished in S9 — `/milk/sales`, `POST
   /api/milk/sales` and the `MilkSale` table are all gone.
   **Milk stock is authoritative** — see the "🥛 Milk stock" section for the opening-number caveat.
3. ~~A unified sale DELETE that restores stock~~ ✅ **SHIPPED in S4.1.**
   `DELETE /api/sales/[id]` restores every line's quantity through the same
   `computeStockDeltas`/`applyStockDeltas` pair the per-module routes use, in one transaction.
   **The unified EDIT (PATCH) is still open** and lands with the screen — CHECKLIST #8.
4. ~~Reports rewritten to `Σ netLineTotal` by `moduleKey`~~ ✅ **SHIPPED in S6**, and S9 removed the
   old routes entirely rather than redirecting them — there is nothing left to redirect to.

**Note on the original scope line:** it said `netLineTotal` would be "apportioned pro-rata with the
residue on the largest line". **That is no longer needed.** S3 ships with NO discounts, so
`netLineTotal === lineTotal` and `totalAmount === Σ netLineTotal` exactly — the invariant holds by
construction. Apportionment only comes back if a bill discount is ever reintroduced, and that is its
own change.

##### ✅ APPLIED 2026-08-12 — Migration D (widen `Product.stock` to Decimal) was NOT code-neutral

**Kept as the record of why, because the lesson generalises: a "one `ALTER TABLE`" widening can
still break the build, and the reason is a hand-written type.** Migration D and its two code fixes
shipped together in commit `8847fff`; the analysis below is what predicted them.

Milk sells in fractional litres, so `Product.stock` had to widen from `Int` to `Decimal(10,2)`, the
same way `SaleItem.quantity` did in Migration C. **It was not a schema-only change**, and anyone
scoping it as "one `ALTER TABLE`, no code" would have got a red build. Analysed 2026-08-12.

The widening is **lossless** — all 27 rows are whole numbers, and `Product.price` in the same table
is already `numeric(10,2)`. The problem is entirely on the code side:

- **`tsc` fails in exactly 4 places**, all the `loadSaleProducts({ findMany })` callback in the
  beverages/bakery create + update routes. **`SaleProduct.stock` in `lib/sales.ts` is a HAND-WRITTEN
  `number`**, not a Prisma-derived type, so the mismatch surfaces at that one boundary and nowhere
  else.
- **That firewall is also the trap.** Everything downstream still believes `stock` is a `number`,
  and two consequences follow — both confirmed by executing the code, not by reasoning:
  - *The arithmetic survives by accident.* `Decimal - number` coerces through `valueOf()`, so
    `findStockShortfalls` still computes correctly.
  - *The JSON does not.* **`failStockBlocked` returns `shortBy` WITHOUT calling `serialize()`**, so
    `available` would ship as the string `"100"` — Gotcha 2 exactly. `StockBlockAlert` feeds it to
    `InlineStockEditor`, whose `next === stock` guard would then compare a number to a string and
    never match.
- **Also blocking:** the `quantity` validator in `lib/validations/sales.ts` is `.int()`, which
  rejects `12.5` before any of this runs.

**Minimal fix:** have `loadSaleProducts` accept the raw Prisma row and normalise `stock` to a number
as it builds its Map — one place, all four route files untouched. `/api/products` is already safe
because it runs through `serialize()`.

**✅ Both fixes shipped with the migration** (`8847fff`): `SaleProductRow` + `toSaleProduct` normalise
stock at the `loadSaleProducts` boundary, and `failStockBlocked` now runs its payload through
`serialize()` as a backstop for the next caller. **The `.int()` validator was deliberately NOT
relaxed** — the unified endpoint got its own decimal-capable `unifiedSaleCreateSchema` instead, so
`2.5` is still an error on the per-module routes.

#### `[x]` **5. Migration B — APPLIED 2026-08-18. The unified rework is finished.**

Five tables dropped: `BeverageSale`, `BeverageSaleItem`, `BakerySale`, `BakerySaleItem` and
`MilkSale`. `public` is down to 14 tables, RLS on all of them.

**Why it was safe, in the order it was established:** the code was repointed and browser-verified
FIRST (commit `60aa4d0`), so the tables had no readers; the Prisma client no longer had the models,
making a reference a compile error rather than a runtime surprise; a fresh backup was verified BY
CONTENTS; and a read-only pre-flight confirmed no old bill was missing from `Sale`. Only then was
`migrate deploy` run.

Full write-up and the post-drop verification: **the "ONE SALE TABLE" section**.

#### `[x]` **6. `lib/receivables.ts` — reads `Sale` ALONE. Closed 2026-08-18 (S9).**

Receivables was the last thing still summing four sale tables. It now aggregates `Sale` and nothing
else, and the module got smaller in every direction:

| | Before S9 | Now |
|---|---|---|
| `getCustomerBalance` | 5 queries + a raw statement | **2** |
| `getCustomerBalances` | 5 | **2** |
| `getTotalOutstanding` | 5 | **2** |
| `getCustomerActivity` | 4 + a JS de-duplication pass | **2** |

The de-duplication is gone with them. It existed because a bill could exist in an old table AND in
`Sale` under the same id, and it had to be applied in TWO places — a SQL guard on the balance paths
and a JS twin on the activity path. Those two disagreeing is not hypothetical: right after S5 the
customer profile listed the same milk sale twice while the balance beside it stayed correct.

**Verified unchanged across the rewrite:** Saif billed 11,000 / outstanding 11,000, and his profile
shows exactly 2 purchases.

The old note's warning — that Migration B would leave 8 routes referencing dropped tables — is
answered: they were repointed first, which is why the migration can be applied without touching code.

#### `[x]` **7. Harden the client `unitPrice` override on UPDATE — CLOSED 2026-08-11**

Shipped. The update branch of `reconcileSaleLines()` no longer reads `line.unitPrice`; an existing
line's price is `productChanged ? product.price : prior.unitPrice`. The override survives on
**create** only. Full reasoning and the asymmetry rule: **Price snapshot → the create/update
asymmetry note**.

**Fixed deliberately BEFORE #8 (the sale edit UI) exists**, while the PATCH route had zero callers
and the change could not regress anything. Verified over authenticated HTTP: a bogus client
`unitPrice` on a quantity-only PATCH was ignored and the stored snapshot preserved.

#### `[x]` **8. Sale edit UI — SHIPPED 2026-08-14 for the UNIFIED sale**

`PATCH /api/sales/[id]` + `/sales/[id]/edit`. **11/11 tested, browser-verified.** It reuses
`reconcileSaleLines` and `computeStockDeltas`, so every rule holds without being restated: a
quantity change keeps the stored price and moves stock by the DIFFERENCE (12 → 8 frees 4), a product
swap re-prices from the database AND re-resolves `moduleKey` (a swap can cross shops), a client
`unitPrice` on an existing line is ignored, and a shortfall refuses the whole edit.

**Two UI decisions follow the server rules rather than taste, and must not be "improved":**

- **An existing line's price is READ-ONLY.** The server refuses to change it (CHECKLIST #7), so an
  editable box would accept a number, save happily and change nothing — a silent no-op is worse for
  the owner than not offering the field. Swapping the product is the supported way to re-price.
- **The CUSTOMER is fixed on an edit.** Moving a bill between customers moves money between two
  ledgers; the API does not accept it.

**"Add another" is create-only** — in edit mode it blanked the lines while still editing THIS bill,
so the next save would have replaced the edited sale's lines from a screen that looked like a fresh
one. Caught in browser testing; it is "Back to sales" when editing.

**The per-module (beverages/bakery) sale edit UI was never built and never will be.** Those screens
and their server-verified `PATCH` routes were deleted in S9 without ever having had one — which was
the right call: an edit screen written against the per-module structure would have been built to be
thrown away, and the unified edit screen replaced both.

<details>
<summary>Original item</summary>

#### `[ ]` **8. Sale edit UI for beverages/bakery**

The `PATCH` route is complete, stock- and discount-aware and server-verified; **there is no
screen.** Lands WITH #4, deliberately — an edit screen written against the current per-module
structure would be built to be thrown away. See the carried-forward "PATCH has no UI" note before
assuming it is dead code.

</details>

---

### 🟡 Phase 8 polish

#### `[x]` **9. `Product.discountPercent` column drop + catalog "Discount" column removal — DONE 2026-08-10**

Migration `20260810180000_drop_product_discount_percent`, one statement:
`ALTER TABLE "Product" DROP COLUMN "discountPercent";` — generated by `migrate diff` against a
verified-empty baseline, so it carried no cascade, no index or constraint drop, and touched no
other column. All three parts shipped together: the column, the `SALE_DETAIL_SELECT` product join,
and the catalog's "Discount" table column.

**It was 13 files, not the 6 predicted here** — see the carried-forward note for which four were
missed and why `prisma/seed.ts` was the dangerous one.

**Verified post-drop against the live database and in the browser:** column gone; all 27 products
byte-identical (md5 of id/name/price/stock/isActive unchanged across the drop); Saif and both real
sales untouched; RLS 18/18 with FORCE RLS 0 and advisors clean at INFO; catalog lists 27 with no
Discount column and no discount field in either dialog; product **create and edit** both still
work; and a discounted sale round-tripped exactly — 3 × 275.50 → 10% line → 743.85 → 5% bill →
706.66, stock 100→97, receipt printing `3 × 275.50  Rs. 743.85` in paise while the screen showed
`3 × Rs. 276  Rs. 744`.

#### `[x]` **10. Touch targets — DONE 2026-08-14, in the primitives**

**Raised once, in the three primitives, exactly as this item asked.** shadcn's defaults were 36 / 32 /
40 / 36px and the Design System requires **44**; 151 call sites had already been patched with `h-11`
one at a time while ~84 buttons and ~40 inputs had not, so the same control was 44px on one screen and
36px on another.

| Primitive | Was | Now |
|---|---|---|
| `button.tsx` default · sm · lg · icon | 36 · 32 · 40 · 36 | **44 · 44 · 48 · 44** |
| `input.tsx` | 36 | **44** |
| `tabs.tsx` TabsTrigger (no height at all) | ≈28 | **min-h-[44px]**, list `h-auto` |

The existing `h-11` overrides are now redundant but harmless (same value) — remove them lazily, not in
one risky sweep. `sm` stays visually smaller (narrower padding, smaller text) but no longer below the
floor: 44px is the minimum for anything a finger must hit.

**Browser-checked on the dense screens** — the catalog's product tables, milk quick entry, and the
customer profile — for layout damage. None: rows simply breathe more.

<details>
<summary>Original item</summary>

#### `[ ]` **10. Touch targets — app-wide, in one place**

`shadcn TabsTrigger` measures **28px** and inline back-links **20px** against the Design System's
**44px** minimum (measured on the customer profile at 360px). These are framework/text defaults,
not one-off mistakes, so they exist wherever those primitives are used.

**Do NOT patch piecemeal as they turn up.** Override the defaults **once** in the primitives.

⚠️ **CORRECTED 2026-08-11 — the primitive defaults are 36px, not ≥44px.** An earlier version of
this item said "everything else measured clean — inputs, buttons and cards are all ≥44px". That is
**false**, read straight from the cva (all three have since been raised — see above):

| Primitive | Default | |
|---|---|---|
| `components/ui/button.tsx` | `default: "h-9 px-4 py-2"` | **36px** (also `sm` h-8 = 32px, `lg` h-10 = 40px, `icon` h-9) |
| `components/ui/input.tsx` | `"flex h-9 w-full …"` | **36px** |
| `components/ui/tabs.tsx` | `TabsList` `h-9` + `p-1`; `TabsTrigger` has **no height**, only `px-3 py-1 text-sm` | **≈28px** |

They reach 44px only where a call site overrides with `h-11` — **151 such overrides exist**, while
**~84 `<Button>` and ~40 `<Input>` usages carry no override** and render at 36px. So the scope is
the three primitive defaults, not one `TabsTrigger` line.

</details>

#### `[x]` **11. PWA — SHIPPED 2026-08-19. Installable, and it caches nothing dangerous.**

Tap once to add to the home screen; after that it opens standalone — no address
bar, ~15% more usable height on a phone, which matters most on milk quick entry.

**Files:** `public/manifest.webmanifest` · `public/sw.js` · `public/offline.html` ·
`public/icon-*.png` (any + maskable, 192/512, plus apple-touch-icon and favicon) ·
`components/providers/pwa-provider.tsx`.

##### 🔴 THE SERVICE WORKER NEVER CACHES `/api/`. Not a preference — a safety rule.

This app's data is stock, prices, sales and farmer balances. A cached API response is a **wrong
number shown confidently**: the owner sells 12 bottles, the till still says 100 in stock, and the
shortfall guard measures against a figure from ten minutes ago.

Only `/_next/static/` is cache-first, and that is safe **by construction** — Next content-hashes
those filenames, so a changed file gets a new name and stale code can never be served. Everything
else is network-first.

Verified in the browser: **30 static entries cached, 0 API entries**, nothing outside
`/_next/static/` and the offline page.

##### It does NOT work offline, deliberately

Queuing sales offline means two queued sales of the last 5 bottles both succeed locally and one has
to lose — discovered afterwards. That is a real feature with real risk, not a service-worker setting.
What exists instead is an honest offline page that says plainly that **nothing part-way through was
saved**.

##### `start_url` and `scope` are both `"/"`

The app is served at the root — `(dashboard)` is a route group contributing nothing to the URL. A
wrong value **404s every home-screen launch but only AFTER install**, so no amount of browser testing
finds it.

##### 🔴 `app/manifest.ts` CANNOT BUILD IN THIS REPO — use the static file

Next's metadata-route loader interpolates the file path into a **single-quoted JS string**, and the
apostrophe in `Muneeb's inventory system` closes it early:

```
Module parse failed: Unexpected token (11:79)
throw new Error('Default export is missing in "E:\...\Muneeb's inventory systempp\manifest.ts"')
```

**The same breakage hits `icon.tsx`, `sitemap.ts`, `robots.ts` and `opengraph-image.tsx`.** Any
dynamic metadata route is unavailable until the folder is renamed without the apostrophe. The cost
here is only that the manifest's shape is not type-checked.

##### The middleware had to learn about two files

`/sw.js` and `/offline.html` are excluded **by name** in `middleware.ts`. The matcher already excluded
`.png` and `.webmanifest`, but not these — and gated, both 307 to `/login`, which makes
`navigator.serviceWorker.register()` fail on a `text/html` response and the install silently never
happen. Named rather than adding `js|html`, which would un-gate any future route ending in `.js`.

#### `[x]` **12. Native date input locale — CLOSED. Verified 2026-08-19, no screen uses one.**

**Confirmed as a real defect and fixed everywhere.** The native `<input type="date">` renders in the
DEVICE's locale — **mm/dd/yyyy** on this machine — so it read American while every date the app
prints is DD/MM/YYYY, leaving `08/14` genuinely ambiguous on a money screen. No formatter of ours can
change a native input.

**Every date control in the app is now one of two shared components**, both built on `Calendar` +
`formatPickedDate`:

| Component | Used by |
|---|---|
| `SaleDatePicker` | the till, milk quick entry, delivery and purchase dialogs, customer payments |
| `DateRangeFilter` | the sales list, the farmer statement |

Values on the wire stay `yyyy-MM-dd`, so Karachi-day filtering is untouched.

**The check, if you ever need to re-run it:**

```bash
# Must return only the comment in DateRangeFilter explaining why it is not used.
grep -rn 'type="date"' app components --include=*.tsx
```

⚠️ **This item said "open on the milk screens" for a while after it was already fixed.** The milk
screens were migrated when their dialogs were built on `SaleDatePicker`; the checklist simply never
caught up. Verified by grep, not by memory.

#### `[ ]` **13. On-device mobile check — a real phone**

The whole app on a real cheap Android phone in daylight, **not a desktop viewport resized to
360px**. *Emulation is geometry, not a device*: it does not reproduce the on-screen keyboard, touch
accuracy, real network latency, or actual paint performance. **Quick entry especially** — it is the
densest screen and the one the owner uses twice a day. Cover loading / empty / error states, the
bottom nav, numeric keypads (`inputMode="decimal"`), and reduced-motion.

---

### 🛒 Catalog & billing features the owner has asked for (added 2026-08-13)

**All four are OWNER-FACING catalog/billing capabilities, not cleanup.** Each ships with
**placeholder values until handover** — the owner sets the real numbers himself, the same way stock
and shop details are his to enter (CHECKLIST #2 / #2b).

#### `[x]` **17. Cooling / chilling charge — SHIPPED 2026-08-14 (Migration E), till payload FIXED 2026-08-18**

> ⚠️ **It was unreachable from the till until 2026-08-18.** The toggle rendered and the server was
> correct, but `chilled` was never put into the create payload — so every bill saved unchilled,
> cheerfully. Found while testing units (same bug, same shape: see the two 🔴 payload warnings in
> `UnifiedSaleForm.tsx` and `CatalogManager.tsx`). **The catalog's EDIT dialog dropped
> `coolingCharge` the same way**, so a charge could only ever be set when a product was created.
> Both fixed and browser-verified: 2 × (100 + 30) = **Rs. 260**, rate 30 snapshotted on the line.


**10/10 tested, browser-verified.** `Product.coolingCharge` (nullable) + `SaleItem.coolingRate`
(default 0). The owner sets the charge **per product** in the catalog — beverages only, since a chill
charge on buns is noise — and the bill carries **a TOGGLE and nothing else**.

> 🔴 **NO RATE FIELD ON THE BILL.** The owner's instruction, 2026-08-14: *"no field when making bill.
> during bill just add a toggle to add cooling charges. the cooling charges has to be added from the
> catalog."* So the client sends `chilled: true/false` and the SERVER reads the amount off the
> catalog row. A client-supplied `coolingRate` is a 400 (`.strict()`). **Do not add a rate override
> to the till** — it would be a second place the number lives, and the point is that there is one.

**The money rule.** `lineTotal = round(quantity × (unitPrice + coolingRate), 2)` — a chilled unit
simply costs more, folded into the SAME `computeLineTotal` every other sale uses. So
`netLineTotal === lineTotal` and `totalAmount === Σ netLineTotal` stay true by construction and
nothing in reports, receivables or the receipt learns a new concept. Verified: 3 × (275.50 + 30) =
**916.50**, Σ netLineTotal checked in SQL.

**NULL ≠ 0 on `coolingCharge`.** Null = never chilled, so no toggle appears. 0 = chilled at no
charge, which DOES show one. Collapsing them puts a chill toggle on every bun.

**The rate is SNAPSHOTTED.** Raising the catalog charge to 500 left a stored bill at its 30 — tested.
An EXISTING line's toggle is not offered on the edit screen for the same reason the price is
read-only there (CHECKLIST #7): the server keeps the stored rate, so an editable control would be a
silent no-op.

**Receipt** prints the combined unit price with a `chilled +30.00/unit` marker, so `2 × 305.50`
multiplies out to the line total — the calculator test that the paise rule exists for. Still inside
32 columns.

**No real product has a charge yet** — the owner sets them, exactly as he does stock and shop
details. Until he does, no toggle appears anywhere.

#### `[x]` **18. Billing-time price override — SHIPPED with the unified till (2026-08-14)**

**The till already does this.** Every line on `/sales/new` carries an editable price field —
`Unit price`, or `Price per litre` for milk — pre-filled from the catalog and overridable per sale,
for EVERY product in the inventory. What the owner types is sent as an explicit `unitPrice` and the
server snapshots it verbatim.

Verified: S4.1 test #6 (a 275.50 override stored exactly, alongside a line that took the catalog's
120 by omission) and the browser pass on the till.

⚠️ **CREATE ONLY, and the EDIT screen enforces that visibly.** On `/sales/[id]/edit` an existing
line's price is rendered READ-ONLY, because `reconcileSaleLines` refuses a client price on a stored
line (CHECKLIST #7) — an editable box there would save happily and change nothing. See #8.

⚠️ **CREATE ONLY.** The override must never reach an edit: `reconcileSaleLines` deliberately ignores
a client `unitPrice` for an existing line (CHECKLIST #7, closed 2026-08-11), because honouring it
would let a closed bill be silently re-priced. See the create/update asymmetry under **Price
snapshot**.

#### `[x]` **19. Multi-unit products — SHIPPED 2026-08-18 (Migration F)**

**13/13 server tests + browser-verified.** `ProductUnit` (name · `baseFactor` · price, unique per
product) plus `SaleItem.unitName` / `SaleItem.unitFactor`, both SNAPSHOTTED. The owner's matrix is
seeded; his prices replace the placeholders at handover.

**🔴 THE ONE RULE: STOCK IS ONE POOL, COUNTED IN BASE UNITS.** A selling unit only says how many base
units leave that pool. `computeStockDeltas` multiplies `quantity × unitFactor`, so 2 peti + 3 dozen of
eggs is **756 eggs off one number** — there is no second stock column, and two units cannot drift
apart or oversell each other.

| Product | Base unit | Selling units |
|---|---|---|
| **Eggs** | **`egg`** — the owner's rule, verbatim: stock in single eggs | dozen = 12 · tray = 30 · peti = **360** (12 trays), at 200 / 500 / 7000 |
| **Beverages** | `bottle` | `pet`, per brand AND per size — see the matrix in `prisma/seed.ts` |

**🔴 A PET IS 12 BOTTLES, NOT 24**, for most sizes here. Every reference table online says 24. The
number is **per brand and per size**, which is why it lives on the product's unit row and not in any
constant. **Gourmet 1.5L carries TWO pets — 4 and 6** (named `pet 4` / `pet 6`); that is real, not a
conflict to resolve.

**`prod_eggs.unit` changed `cotton` → `egg`** on 2026-08-18. It had zero sale history, so nothing
historical moved. The seed could not do it — the seed is additive (`update: {}`) and must never
overwrite a row the owner may have edited.

Three rules that follow, and must not be softened:

- **The client sends the unit's NAME. The factor never leaves the server.** `unitFactor` in a request
  body is a 400 (`.strict()`). A wrong factor is the one value that silently drains a stock pool.
- **The factor is SNAPSHOTTED on the line.** Re-defining a pet from 12 to 6 in the catalog does not
  move what a closed bill sold, and deleting a unit does not orphan one.
- **A shortfall is reported in BASE units** — "100 in stock but this sale needs 360" — because the
  pool is eggs. Reporting it in peti would be a number the owner cannot check against his shelf.

**Reports count base units too** (`quantity × unitFactor`), per the owner's answer, so the per-product
table says 756 eggs rather than "2 peti and 3 dozen".

⚠️ **The seed created 47 new beverage products at price 0** to hold the matrix (Sprite, Dew, 7Up,
Mirinda, Sting, Fruitien Joy, Mojo, Local Quarter, Gourmet Cola/Lemon, plus the 250ml/350ml/2L sizes
of Pepsi and Coke Cola). **The owner prices what he stocks and deactivates the rest** — the same
handover step as stock counts and shop details. The four flavourless `Gourmet <size>` rows are left
exactly as they were.

#### `[x]` **20. Per-product sales visibility in reporting — COMPLETE 2026-08-14**

Reports currently answer "how much did Beverages sell". The owner also needs **each product's units
sold**, not just per-category — and **milk shown as its own line**.

**PARTLY SHIPPED in S6 (2026-08-14).** `getProductSales()` in `lib/reports.ts` groups by
`(productId, moduleKey)` across the old item tables AND `SaleItem`, so every product's units and
revenue are available with **milk on its own line** — exposed today as the **`product_sales` CSV
export**, and `top-products` now accepts `module=milk` for the first time.
✅ **COMPLETE 2026-08-14.** The on-screen table ships as `components/reports/ProductSalesTable.tsx`
on `/reports`, backed by `GET /api/reports/product-sales`, alongside the `product_sales` CSV. The
retired `MilkSale` rows are mapped to `prod_milk` inside `getProductSales` so the table reconciles
EXACTLY with the module revenue shown above it — otherwise it would report 12.5 L of milk while the
summary said 62.5, and the owner would have to pick which of his own screens to believe.

---

### ⚪ Handoff infra

#### `[x]` **14. Geography — CLOSED 2026-08-19. Database and functions are both in Mumbai.**

Three separate problems wore the same disguise ("queries take ~1.1s"), and all three are fixed:

| | Was | Now |
|---|---|---|
| Transaction pooler overhead | ~950 ms per query | gone — session pooler on `:5432` |
| Database region | `ap-northeast-2` Seoul, ~5,000 km | **`ap-south-1` Mumbai**, ~1,300 km |
| Function region | `iad1` Washington DC | **`bom1` Mumbai** — `vercel.json` |

Round trip from the dev machine: **226 ms → 96 ms**, 20 samples warm.

##### 🔴 The function region was not optional — without it the move BACKFIRED for production

Washington→Seoul is ~11,000 km; Washington→**Mumbai** is ~12,500 km. Moving the database to Mumbai
put it FURTHER from functions running in `iad1`. Local development got faster and production would
have got slower, silently, with a green deploy.

**Verified by the `x-vercel-id` header on an SSR render of a preview deploy:**

```
before   bom1:iad1::iad1::…     edge PoP Mumbai, function Washington
after    bom1::…                function Mumbai
```

`{"regions": ["bom1"]}` in `vercel.json`. **The Hobby plan accepts a single region** — no upgrade
needed for this.

⚠️ **The MIDDLEWARE is unaffected, and that is correct.** It runs on the Edge runtime, which
`regions` does not govern, and it touches no database — precisely what the split auth config exists
for (Gotcha 3). An `x-vercel-id` of `bom1:iad1::` on a 401 is the edge path, not the serverless
function; measure the region on a request that actually reaches a route handler.

##### Vercel env vars — updated 2026-08-19

`DATABASE_URL` and `DIRECT_URL` now point at Mumbai for **both Preview and Production**.

⚠️ **`vercel env rm NAME production` removes the variable from EVERY environment, not just the one
named.** It silently took Preview with it; both had to be re-added. Check `vercel env ls` after any
removal.

⚠️ **`vercel env pull` REDACTS encrypted values** — they come back as a 13-character placeholder, so
you cannot verify what you set by reading it back. The only real verification is a deployment.

**Env vars only apply to NEW deployments.** Production keeps the old values until
`vercel deploy --prod`.

#### `[ ]` **15. Data API surface — an owner decision, not a leak**

`anon` / `authenticated` retain table-level GRANTs on every table in `public` (Supabase's default).
RLS makes those grants useless for reading rows, so this is **not** a leak — but the
PostgREST surface still exists. Restricting the exposed schemas or disabling the Data API is
pending the owner's call; it would not affect Prisma, which never goes through PostgREST.

#### `[x]` **16. Untracked migrations — CLOSED. All 12 are in git (verified 2026-08-18)**

Both of the directories this item named are committed, along with every migration since. Confirmed
with `git ls-files prisma/migrations`, which lists all 12 — so a fresh clone builds the same database
this one has, which is the property the item existed to protect.

<details>
<summary>Original item</summary>

```
?? prisma/migrations/20260809180000_unify_sale_tables_part_a/
?? prisma/migrations/20260810180000_drop_product_discount_percent/
```

Both are **applied** and recorded in `_prisma_migrations` (2026-08-09 15:07 and 2026-08-10 12:58),
but neither directory is committed. **A fresh clone would not contain them**, so `migrate deploy`
on a new environment would build a database missing the unified `Sale` tables and still carrying
`Product.discountPercent` — silently diverging from this one.

The second is part of the uncommitted item #9 change set and goes in with it. The first has been
untracked since 2026-08-09. **Commit both.** Also worth running `npx prisma migrate status` once
after, to confirm git and `_prisma_migrations` agree.

</details>

---

### `[x]` Closed — recorded so they are not re-opened

- **`[x]` `Product.discountPercent` column drop** (was #9). **Closed 2026-08-10.** One-statement
  migration, 13 files, verified post-drop in the browser including a discounted sale. The column
  cannot come back without reintroducing the variant model — see Discounts, russ, eggs.
- **`[x]` Login POST-only security fix** (was BLOCKER #1). **Closed 2026-08-10.** Form is
  `method="post" action="/api/auth/no-js-login"`; that route is POST-only (405 otherwise).
  Verified with script execution genuinely disabled — credentials went in the request body, the
  URL stayed bare. The rules that must not be undone live in the **Authentication** section.
- **`[x]` Context7 connection diagnosis** (was: down 8 consecutive sessions, 3–9 Aug). **Closed
  2026-08-10** — it reconnected on its own and was verified live with a `resolve-library-id` call.
  No diagnosis was needed. Pin Prisma lookups to `/prisma/prisma/__branch__6.19.x`; see MCP Tools.
- **`[x]` Delete-guard 409 / soft-delete re-test.** Closed 2026-08-04, all three levels passed.
- **`[x]` Preview-deploy auth** (`useSecureCookies` pinned). Closed 2026-08-08.
- **`[x]` Milk hub / balance-sheet payable mismatch** (17,000 vs 21,000). Closed in Phase 6.

---

## Seed Data (dev)

**Beverages** (each brand is a SubCategory):
- Pepsi, Coke Cola, Gourmet: sizes 0.5L / 1L / 1.5L / 2.25L, each at full price plus 20% / 30% / 60% discount variants (separate products, discountPercent stored, price 0 until owner sets).
- Juice: Half Litre, 1 Litre (no discount variants).
- Big Apple, Big Lychee: one product each (no sizes).

**Bakery:**
- Cake Rusk Premium, Cake Rusk Simple
- Buns
- Biscuits Premium, Biscuits Simple
- Russ Large Circle, Russ Large Rectangular Round, Russ Small Circle, Russ Small Rectangular Round
- Eggs (unit: cotton)

All prices default to 0, all isActive true. Owner sets prices via the price editor.