# CLAUDE.md - Business Management App
# Pepsi Agency · Bakery · Milk Shop

> Place this file at the ROOT of the project repo.
> Claude Code reads it automatically at the start of every session.
> Keep it updated as the schema or business rules evolve.

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

### Receipt printing (thermal) — ⚠️ 58mm SUPERSEDED PENDING CONFIRMATION (2026-08-13)

> **🔴 UPDATE 2026-08-13 — DESIGN THE RECEIPT FOR 80mm.**
> The owner is **buying a new printer**, and **80mm thermal is RECOMMENDED**. The 58mm decision below
> was made when we had no information about the printer at all; that is no longer the situation.
>
> **This is superseded PENDING CONFIRMATION, not yet changed in code.** `RECEIPT_LINE_CHARS` is still
> **32**. **When the printer is confirmed, set `RECEIPT_LINE_CHARS = 48`** — and the `shopName` cap
> follows automatically, because it is derived from that constant rather than hardcoded (which is
> exactly why it was built that way).
>
> **The 58mm reasoning below is kept, not deleted.** It still documents why the constant exists, why
> everything derives from it, and the asymmetric-risk argument — which remains correct and is the
> reason changing this is a one-line change rather than a layout rewrite.

**The receipt layout is built for a 58mm roll: `RECEIPT_LINE_CHARS = 32`, in
`lib/settings-display.ts`. Derive every width from that constant — never hardcode 32.**

| Roll | Print head | Font A (12 dots/char) | Font B (9 dots/char) |
|---|---|---|---|
| **58mm (assumed)** | 384 dots | **32 chars/line** | 42 |
| 80mm | 576 dots | 48 chars/line | 64 |

*(Standard ESC/POS figures. **Not measured against the owner's printer** — see below.)*

**Why 58mm when we do not know the printer: the risk is asymmetric.** A 58mm layout also prints
on 80mm — it just leaves margin. An 80mm layout **overflows** 58mm and wraps every line into
nonsense. Default to the narrow assumption; the failure mode of guessing narrow is a bit of white
space, and the failure mode of guessing wide is an unreadable receipt.

~~**We have no information about the actual printer.**~~ **Superseded 2026-08-13 — see the update at
the top of this section.** As of 2026-08-10 nothing in the repo had ever recorded a model, an
interface, or a paper width, which is what forced the narrow default. **The owner is now buying a new
printer and 80mm is recommended**, so the expected end state is
`RECEIPT_LINE_CHARS = 48` with the shop-name cap following automatically. **Still confirm the actual
roll before changing the constant** — the risk asymmetry above is unchanged, and a wrong guess in the
wide direction wraps every line into nonsense.

**Double-width header text halves the budget to 16 characters.** That is a RENDERING decision for
the receipt, not a validation one: print a long shop name at normal width rather than letting the
validator reject a real name that would fit perfectly.

**Field caps derived from this** (see also CHECKLIST #2b):

| Field | Cap | Why |
|---|---|---|
| `shopName` | **32** | Exactly one 58mm line |
| `shopPhone` | 60 | ~2 lines; enough for two numbers as free text |
| `shopAddress` | 200 | Wraps to ~6 lines; a paste guard, not a format rule |

---

## Folder Structure

### URL layout (decided, do not change without a reason)

**The app is served at the root.** `(dashboard)` is a parenthesised route group, so it
contributes a shared layout and contributes NOTHING to the URL. There is no literal
`/dashboard` folder and none should be added.

| Page | URL |
|---|---|
| Dashboard home | `/` |
| Modules | `/beverages`, `/bakery`, `/milk`, `/customers`, `/catalog`, `/reports` |
| Login | `/login` — **the only unauthenticated page** |

`DEFAULT_LOGIN_REDIRECT` is `"/"`. Route constants live in `/lib/routes.ts`.

```
/app
  /api                     → Route Handlers (serverless). runtime="nodejs" where Prisma/bcrypt used.
    /sales/route.ts        → UNIFIED sale POST (S3, live 2026-08-13) + GET list (S4.1,
                             2026-08-14). Beverages+bakery+milk on ONE bill; no discounts.
    /sales/[id]/route.ts   → UNIFIED sale GET one + DELETE (S4.1). ⚠️ The DELETE RESTORES
                             STOCK — and normalises `Number(item.quantity)` first, because
                             SaleItem.quantity is Decimal and computeStockDeltas takes a
                             number. No PATCH yet (edit is still CHECKLIST #8).
  /receipt/sale/[id]       → the UNIFIED receipt (S4.2). Sibling of /receipt/[module]/[id],
                             not a third module value — it reads a different table.
  /(dashboard)/sales/      → the unified till: list + /sales/new (S4.2). ZINC accent.
  /(auth)/login            → Owner login page → /login
  /(dashboard)             → layout group ONLY, adds nothing to the URL
    /layout.tsx            → Protected layout with nav
    /page.tsx             → Dashboard home (summary + charts) → /
    /beverages/           → Beverages module
    /bakery/              → Bakery module
    /milk/                → Milk shop module (deliveries, purchases, sales, balances)
    /catalog/             → Category + product manager
    /customers/           → Customer ledger + receivables
    /reports/             → Analytics + CSV export
/components
  /ui                     → shadcn components (auto-generated, do not hand-edit)
  /beverages  /bakery  /milk  /customers
  /shared                 → DataTable, PageHeader, StatCard, MoneyText, EmptyState, etc.
/lib
  /prisma.ts              → Prisma client singleton
  /auth.ts                → Full NextAuth (Node) config
  /auth.config.ts         → Edge-safe NextAuth config for middleware
  /routes.ts              → Route constants (dependency-free, client+edge safe)
  /serialize.ts           → Decimal → number serializers (money/liters)
  /format.ts              → formatPKR(), formatDate(), Karachi date helpers
  /utils.ts               → misc helpers
  /sales.ts               → THE money + stock + price-snapshot implementation (per-module)
  /unified-sales.ts       → unified sale: loadUnifiedSaleProducts, resolveLineModule,
                            UNIFIED_SALE_PRODUCT_SELECT, UNIFIED_SALE_DETAIL_SELECT
  /modules.ts             → MODULE_CATEGORIES (beverages | bakery | milk) → Category
  /milk.ts                → FARMER side only: deliveries, purchases, balances, ledger
  /milk-sales.ts          → milk SHOP sales (split out in S2, 2026-08-12)
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

  // REQUIRED back-relations (do not remove, migration fails without them)
  beverageSaleItems BeverageSaleItem[]
  bakerySaleItems   BakerySaleItem[]
  saleItems         SaleItem[]        // unified Sale (Migration A)
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
  beverageSales BeverageSale[]
  bakerySales   BakerySale[]
  milkSales     MilkSale[]
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

### Beverages

```prisma
model BeverageSale {
  id          String             @id @default(cuid())
  customerId  String
  customer    Customer           @relation(fields: [customerId], references: [id])
  saleDate    DateTime           @default(now())
  totalAmount Decimal            @db.Decimal(10, 2)
  notes       String?
  items       BeverageSaleItem[]
  createdAt   DateTime           @default(now())

  @@index([customerId, saleDate])
}

model BeverageSaleItem {
  id        String       @id @default(cuid())
  saleId    String
  sale      BeverageSale @relation(fields: [saleId], references: [id], onDelete: Cascade)
  productId String
  product   Product      @relation(fields: [productId], references: [id])
  quantity  Int
  unitPrice Decimal      @db.Decimal(10, 2)   // snapshot at time of sale
  lineTotal Decimal      @db.Decimal(10, 2)
}
```

### Bakery

```prisma
model BakerySale {
  id          String           @id @default(cuid())
  customerId  String
  customer    Customer         @relation(fields: [customerId], references: [id])
  saleDate    DateTime         @default(now())
  totalAmount Decimal          @db.Decimal(10, 2)
  notes       String?
  items       BakerySaleItem[]
  createdAt   DateTime         @default(now())

  @@index([customerId, saleDate])
}

model BakerySaleItem {
  id        String     @id @default(cuid())
  saleId    String
  sale      BakerySale @relation(fields: [saleId], references: [id], onDelete: Cascade)
  productId String
  product   Product    @relation(fields: [productId], references: [id])
  quantity  Int
  unitPrice Decimal    @db.Decimal(10, 2)   // snapshot at time of sale
  lineTotal Decimal    @db.Decimal(10, 2)
}
```

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

// Milk SOLD to hotels/shops/individuals (owner's outbound milk sales)
model MilkSale {
  id           String   @id @default(cuid())
  customerId   String
  customer     Customer @relation(fields: [customerId], references: [id])
  saleDate     DateTime @default(now())
  liters       Decimal  @db.Decimal(8, 2)
  ratePerLiter Decimal  @db.Decimal(8, 2)
  totalAmount  Decimal  @db.Decimal(10, 2)   // liters * ratePerLiter
  notes        String?
  createdAt    DateTime @default(now())

  @@index([customerId, saleDate])
}
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

## 🧭 WHICH SALE TABLES ARE LIVE — RE-VERIFIED 2026-08-11, re-check before believing otherwise

> **This section has been correct all along; the SESSION BRIEFS drifted from it, not the reverse.**
> Across seven consecutive briefs an upstream summary asserted the opposite — "unified Sale is the
> only sale model", "Migration B done", "the guard was repointed" — none of which was true in this
> repo. A full ground-truth audit on 2026-08-11 re-confirmed every claim below.
> **If a session brief and this section disagree, run the grep. The grep wins.**

> **⚠️ UPDATE 2026-08-14 — PARTIAL SWITCH-OVER.** The unified path is **LIVE END TO END**:
> `POST /api/sales` (S3, `90e8609`), `GET`/`DELETE` (S4.1), and the SCREEN at `/sales` + `/sales/new`
> with its own receipt at `/receipt/sale/[id]` (S4.2). **`lib/receivables.ts` now counts unified
> sales**, so a bill rung on the new till reaches the customer's outstanding balance.
>
> **STILL READING THE OLD TABLES ONLY: REPORTS** (`lib/reports.ts` — revenue, counts, trend, top
> products) **and the CSV export.** A unified sale therefore appears in balances and on a receipt but
> **not in any report figure** until the S6 repoint. The old per-module create routes and screens are
> also still live. Both paths coexist **BY DESIGN** until S9.
>
> **The grep below now returns matches — that is EXPECTED, not the dormant state.** Once any
> unified sale is created, Migration A's row is no longer the only `Sale` row.

**The app runs on `BeverageSale` / `BakerySale`. `Sale` / `SaleItem` exist but NOTHING reads or
writes them.** The unified rework is HALF shipped: the data was migrated (migration A), the
application was never switched over.

This has now been misread in both directions across sessions, so here is the 10-second check.
**Run it before you assert either state:**

```bash
grep -rn "prisma\.sale\.\|prisma\.saleItem\." app lib components --include=*.ts --include=*.tsx
```

**Zero matches = the unified tables are still dormant.** One or more = the switch-over has happened
and this section is out of date; update it in the same commit (see the process rule at the top).

| Thing | Live today | Notes |
|---|---|---|
| Create a sale | `tx.beverageSale.create` / `tx.bakerySale.create` | per module; a mixed-category sale is **rejected** by `loadSaleProducts` |
| List / read / update | `prisma.{beverage,bakery}Sale.*` | `PATCH` exists and is server-verified but has **no UI** |
| Sale form | `NewSaleForm` at `/beverages/new-sale` and `/bakery/new-sale` | posts to `SaleModule.apiBase` |
| **`/sales`** (the SCREEN) | **LIVE since S4.2** | `app/(dashboard)/sales/` — list + `/sales/new` till. Zinc accent: a cross-module bill claims no module colour |
| Reports revenue | `SUM("totalAmount") FROM "BeverageSale" / "BakerySale"` | sale-level, NOT `Σ netLineTotal` |
| Reports top products | `prisma.{beverage,bakery}SaleItem.groupBy` on `lineTotal` | per-module item tables |
| Receipt | `lib/receipt.ts` → the same two tables | correct: it prints what the app can actually create |

### ⚠️ `SALE_DETAIL_SELECT` targets the OLD tables, despite the generic name

It lives in `lib/sales.ts` and is written generically **because `BeverageSale` and `BakerySale` have
identical shapes** — that is Phase 4's code-sharing, not a sign that it points at `Sale`. Every one
of its call sites is preceded by `prisma.beverageSale.*` or `prisma.bakerySale.*`; **none uses
`prisma.sale`.** The name has caused a misread before. Do not infer the target from it — grep the
call sites.

### Why the old tables still exist

**They are the pre-Migration-B rollback, and that is correct.** Migration B (dropping
`BeverageSale`, `BeverageSaleItem`, `BakerySale`, `BakerySaleItem`) is **not written and not run** —
no migration in `prisma/migrations/` contains `DROP TABLE`. It stays that way until the switch-over
is built AND browser-verified, because today those four tables hold the live data: dropping them now
would break every sale screen and every report immediately.

`Sale` currently holds exactly one row — migration A's copy of Saif's bakery sale, carrying the
original's id (`cmsjh3kly0002uve8ajkvs2ji`) and its pre-migration `createdAt`. A sale created through
a live unified flow would have a fresh id and a `createdAt` after 2026-08-09 15:07. None exists.

Tracked as CHECKLIST #4 (switch-over) and #5 (Migration B).

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
totalBilled      = SUM(beverageSales.totalAmount + bakerySales.totalAmount + milkSales.totalAmount) for customer
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
untouched. See the create/update asymmetry note above, and
`docs/responses/2026-08-11-snapshot-hole-7-closed.md`.

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
| ~~A sale on `/milk/sales`~~ | **retired 2026-08-14** — that screen can no longer create a sale |

~~**The screen the owner uses does not decrement milk stock.**~~ **Closed by S4.3.** Milk selling
moved to the unified till; `/milk/sales` is now a HISTORY screen (list, edit, delete, export) that
keeps the sales recorded before the move, including the owner's real Rs. 6,000 one. `POST
/api/milk/sales` still exists but nothing calls it — **do not wire a new screen to it, and do not add
a stock decrement there**; it retires with the other per-module paths at S9.

**⚠️ ONE CAVEAT, AND IT IS ABOUT THE OPENING NUMBER, NOT THE ARITHMETIC.** `prod_milk.stock` started
at 0 and the real 250 L delivery predates the bridge, so it was never added. Every movement SINCE the
bridge is correct; the starting point is not a count of the fridge. **The owner sets the true opening
litres at handover**, exactly as he does for every other product's shelf count (CHECKLIST #2). Until
then the figure is a running total from zero, not an inventory.

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
survived seven phases. Evidence and method:
`docs/responses/2026-08-10-login-post-only-security-fix.md`.

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

**Verify after — all read-only** (worked example:
`docs/responses/2026-08-12-post-restore-verification.md`):

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

**Row Level Security is ENABLED on all 18 tables in `public`, with ZERO policies. This is
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
  That role has `rolbypassrls = true` **and** owns all 18 tables — two independent reasons RLS
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

`get_advisors({ type: "security" })` reports 18 × `rls_enabled_no_policy` at **INFO** level.
That is the healthy steady state, not a regression. The thing to watch for is
`rls_disabled_in_public` at **ERROR** level — that means a new table slipped through.

### Still open

`anon` / `authenticated` retain table-level GRANTs on all 18 tables (Supabase's default for
`public`). RLS makes those grants useless for reading rows, so this is not a leak — but the
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

### Never fan out Prisma queries with Promise.all (pooled connection = 1)

**`DATABASE_URL` carries `connection_limit=1`, so a `Promise.all` of Prisma queries does NOT
run in parallel — the first executes and the rest QUEUE for the single connection. Await
multiple queries in SERIES.**

Past ~8 concurrent queries the ones at the back exceed the 10s pool timeout and the request
fails outright:

```
Timed out fetching a new connection from the connection pool.
(Current connection pool timeout: 10, connection limit: 1)
```

Found in Phase 4b: the customer profile fanned out 12 concurrent queries and 500'd in the
browser while `tsc` and `next lint` were both clean. Sequential costs nothing real — with one
connection there was never any parallelism to lose — and it cannot time out waiting for
itself. The same limit applies on Vercel, so this is not a dev-only concern.

Two or three concurrent queries are fine in practice; the rule is to prefer series and never
nest a `Promise.all` inside another. Where a route needs many rows, fetch them ONCE and derive
everything from that set — the profile route was also fetching every sale twice, once for the
ledger and once for the purchases list. See `getCustomerActivity()` in `lib/receivables.ts`.

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
feedback. Verified fixed in-browser — recovery in ~305ms. See
`docs/phase-3.2-fixes-verified.md` §4.

### One database round trip costs ~1.1s — the QUERY COUNT is the whole budget

**Measured, Phase 7: a single Prisma query against this Supabase project takes about
1.1 seconds.** Not the query — the round trip. That number, multiplied by
`connection_limit=1` forcing everything into series, is the performance model for this app:

| Queries in a request | Roughly |
|---|---|
| 3 (a normal screen) | ~3s |
| 7 | ~9s |
| 18 | **~19s — past the 15s client timeout in `lib/api-client.ts`** |

The reports summary shipped its first draft at **18 queries / 19.2s** and the dashboard
rendered *"Can't reach the server. Check your connection."* against a perfectly healthy
database. Cutting it to **7 queries / 9.5s** fixed it. Two techniques did the work, and both
are reusable:

- **Collapse independent aggregates into ONE statement.** Five `prisma.aggregate` calls over
  five tables became one `SELECT (subquery), (subquery), …` — five round trips to one. See
  `getReportSummary` in `lib/reports.ts`.
- **Don't compute the same thing twice.** The summary was calculating each module's top
  product (4 queries) that the dashboard was already fetching for its charts.

**Before adding a query to an existing route, count what is already there.** A route that
creeps past ~12 queries will start failing in the browser while every test you have still
passes, because `tsc`, lint and the API itself are all perfectly happy at 19 seconds.

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
DATABASE_URL=     # Supabase pooled connection (?pgbouncer=true&connection_limit=1)
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

### ⚠️ HANDOFF INFRA ITEM — the function and the database are on different continents

Function in **`iad1`** (Washington DC), Supabase in **`ap-northeast-2`** (Seoul): ~11,000 km on
every query, measured at **≈1.07s each** against the deployed function. **This is the ~1.1s/query
floor the whole app is designed around** — see "One database round trip costs ~1.1s" in API Route
Conventions, which is the practical consequence, and the progressive load on `/reports`, which is
the mitigation already in place.

**→ Measurements, the fix (`icn1`), and its go-live timing: PRE-HANDOFF CHECKLIST item 14.**

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
- **Production is deliberately a PHASE 1 BUILD.** Every route from Phases 2–7 returns 404
  there, because only preview deploys have been run. That is by design: **production goes live
  at client handoff, on Pro.** Do not `--prod` deploy to chase a number or to "check" something.
  Auth itself works correctly on production (307 signed out, passes middleware signed in).

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
| 8  | Polish: mobile nav, states, a11y, PWA, ~~login POST-only security fix~~ (✅ done 2026-08-10), final validation | ⬜ Todo |

Update this table as phases complete. Change ⬜ to ✅.

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
| **S5** | migrate the 2 real sales onto `Sale` / `SaleItem` | ⬜ Todo |
| **S6** | reporting repoint to `Σ netLineTotal` by `moduleKey` + **per-product visibility** (#20) | ⬜ Todo |
| **S7** | catalog features: cooling charge (#17), billing-time price override (#18) | ⬜ Todo |
| **S8** | multi-unit products — eggs dozen/tray/peti, beverages bottle/pet, one stock pool (#19) | ⬜ Todo |
| **S9** | remove the old per-module paths, then **Migration B** (drop the 4 old tables) — CHECKLIST #5 | ⬜ Todo |

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
| 🔴 | **Data reset before go-live**, and with it **the owner's real shop details saved in Settings** (the seeded `SET SHOP NAME IN SETTINGS` placeholders must be gone — `configuredAt IS NOT NULL`). The owner must start on a database holding only his own real records. Once, deliberately, with the delete set confirmed first. | `[ ]` open | CHECKLIST #2 + #2b |

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
  the seed. Reports: `docs/phase-2.1-api-routes.md`, `docs/phase-2.1-deploy-verification.md`,
  `docs/phase-2.2-catalog-ui.md`, `docs/phase-2.3-seed-run.md`. Three things Phase 3 inherits:
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
    renders a per-product sale count that appears nowhere in the sentence. Evidence:
    `docs/responses/2026-08-04-delete-guard-retest.md`. Keep it working; it no longer needs
    re-testing.
  - **`tailwind.config.ts` content globs must include `./lib`.** The `ACCENTS` map in
    `lib/nav.ts` is the only place module accent classes appear as literals; dropping `./lib`
    silently strips them from the CSS and colours fall back to default foreground. This bit
    us once already — see `docs/phase-2.3-seed-run.md` §6.
- **Phase 3 delivered:** the beverages sale API (3.1) and UI (3.2) — `/beverages` and
  `/beverages/new-sale`. Reports: `docs/phase-3.1-beverages-api.md`,
  `docs/phase-3.1-review-signoff.md`, `docs/phase-3.2-beverages-ui.md`,
  `docs/phase-3.2-browser-verification.md`, `docs/phase-3.2-fixes-verified.md`.
  Four things Phase 4 (Bakery) inherits:
  - **`reconcileSaleLines()` in `lib/sales.ts` is THE price-snapshot implementation.** Reuse
    it; do not re-derive the predicate. Same for `SALE_DETAIL_SELECT` and `loadSaleProducts`,
    which are written generically because BakerySale has the same relation names.
  - **The global TanStack Query settings above are not optional.** See the client
    data-fetching note in API Route Conventions.
  - **The delete-guard 409 / soft-delete re-test is DONE** — run 4 Aug 2026, all three levels
    passed, DB restored to baseline. See the Phase 2 note above and
    `docs/responses/2026-08-04-delete-guard-retest.md`. No longer an open item.
  - **Verify UI in a real browser, not on a build.** Phase 3.2 type-checked, linted and built
    green while still carrying three real bugs — one of which trapped the owner with no way to
    recover. The build proves it compiles, nothing more.
- **Phase 4 delivered:** the bakery module — `/bakery`, `/bakery/new-sale`, and
  `/api/bakery/sales`. Reports: `docs/phase-4-bakery-module.md`,
  `docs/responses/2026-08-07-phase-4-browser-verification.md`. What later modules inherit:
  - **The sale components are SHARED, in `/components/sales/`**, parameterised by a
    `SaleModule` from `lib/sale-modules.ts` (endpoint, catalog category, accent, copy).
    Milk sales should add a config row, NOT a third copy of the form. If you find yourself
    forking one of these components, that is the signal to parameterise instead.
  - **Query keys are module-scoped** — `["sales", module.key, …]` in `lib/hooks/use-sales.ts`.
    Without the module segment, opening one module's list shows the other's rows from cache.
    Verified behaviourally: 12 samples across rapid switches, no leak.
  - **A unit suffix is shown only when the unit ADDS information.** `SELF_EVIDENT_UNITS` in
    `lib/sale-catalog.ts` suppresses "bottle"/"piece"; eggs keep "Quantity (cottons)" because
    a bare "3" is genuinely ambiguous. It is a property of the unit, not the module — do not
    add per-module branching.
  - **Picker labels use every attribute a product carries** (size, qualityTier, shape,
    discount) and fall back to the brand when it carries none. Composing from size+discount
    alone made `Biscuits Premium`/`Simple` and all four Russ variants indistinguishable.
- **Phase 4b delivered:** the customers hub + receivables — `/customers`, `/customers/[id]`,
  and the `/api/customers/*` tree. Report:
  `docs/responses/2026-08-07-phase-4b-customers-receivables.md`. Three things that carry
  forward:
  - **`lib/receivables.ts` is THE receivables calculation**, the way `reconcileSaleLines` is
    THE price snapshot. `outstanding = billed − paid`, billed spans beverages + bakery +
    **milk**. Reports and dashboards must call it, not re-derive it.
  - **MilkSale is already counted**, ahead of its Phase 5 UI. Empty table contributes 0, so
    when milk sales start being recorded the balances are correct with no change here.
  - **A customer is never hard-deleted** — soft only, like a Product with sale history.
- **Phase 5 delivered:** the milk shop — `/milk`, `/milk/quick-entry`, `/milk/farmers/[id]`,
  `/milk/sales`, and the `/api/milk/*` tree. Report:
  `docs/responses/2026-08-08-phase-5-milk-shop.md`. **No migration was needed** — all four
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
  Report: `docs/responses/2026-08-08-phase-6-balance-sheet.md`. **No new API route, no new
  query, no new arithmetic** — it consumes the existing `/api/milk/farmers` response, which
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
  screens. Report: `docs/responses/2026-08-08-phase-7-reports.md`. What carries forward:
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
- **⚠️ THE BEVERAGES/BAKERY SALE `PATCH` IS FULLY IMPLEMENTED AND HAS NO UI. IT IS NOT DEAD CODE.**
  This is the single easiest thing in the repo to mistake for cruft and delete. Do not.
  - **What exists:** `PATCH /api/{beverages,bakery}/sales/[id]` is complete and server-verified.
    It reconciles line edits through `reconcileSaleLines`, carries the **discount** snapshot
    through, and reconciles **stock** by delta — quantity up/down adjusts by the difference, a
    removed line restores its full quantity, a new line decrements, a product swap restores the
    old product and takes the new, and two lines of the same product net to one adjustment. All
    inside one transaction.
  - **What does not exist:** any way for the owner to reach it. There is no `useUpdateSale` hook
    and the beverages/bakery sale lists offer Delete only. (Milk sales *do* have an edit dialog —
    the two modules that share `reconcileSaleLines` are the ones without.)
  - **Verified how:** the edit paths were exercised against the API over real HTTP in an
    authenticated browser session, with before/after stock numbers, on 2026-08-09. Server logic is
    proven; the screen is what is missing. See
    `docs/responses/2026-08-09-stock-tracking-shipped.md` §3–4.
  - **Where the UI lands: with the UNIFIED CROSS-CATEGORY SALE, not before.** Deliberately not
    built standalone — that rework rebuilds the sale form anyway, and an edit screen written
    against the current per-module structure would be built to be thrown away. The route being
    already stock- and discount-aware is what makes deferring it safe.
  - Consequence worth stating: **the hardest behaviour in the stock feature (12 -> 8 freeing 4) is
    currently correct and unreachable.** If someone reports "editing a sale doesn't work", the
    answer is that there is no edit screen yet — not that the reconciliation is broken.
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

**Verified against the repo and the live database on 2026-08-10.** Status is what is TRUE now, not
what was planned.

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
rejected in place, good password lands on `/`). Full evidence:
`docs/responses/2026-08-10-login-post-only-security-fix.md`.

#### `[ ]` **2. [BLOCKS GO-LIVE] One deliberate data reset before go-live**

**Status:** open. **Do it ONCE, at handoff — never incrementally.** Piecemeal cleanup is how a row
that turned out to matter gets lost; every verification pass so far has been `ZZ_TEST_`-scoped
precisely so this can be a single decision at the end.

The owner should start on a database holding only his own real records, not the working set that
accumulated while the app was built.

**Decide explicitly what survives:** the owner account, the catalog (categories, sub-categories,
products) with real prices, and real customers/farmers — versus everything transactional (sales,
deliveries, purchases, payments), which almost certainly should not.

**Stock is the subtle one.** All 27 products sit at the migration's temporary default of **100**,
which is not a real count. The reset is the moment the owner walks the shelf and enters actual
numbers — **his task, not a figure for us to invent.**

**Confirm the exact delete set with the owner before running it**, the same way the 36-variant
delete and every other destructive step here was confirmed.

> ⚠️ **Confirm the count against the environment actually being handed over.** In the database this
> repo points at (project `wcfdtxalwlztfsbepkrr`, the ref in `.env`), **re-verified 2026-08-11**:
>
> | | rows |
> |---|---|
> | `BakerySale` | **1** — Rs. 5,000, customer Saif, still in the OLD table |
> | `MilkSale` | **1** — Rs. 6,000 |
> | `BeverageSale` | **0** |
> | `Sale` (unified) | 1 — migration A's copy of the bakery row, not a second sale |
> | `Customer` | **1** — Saif |
> | `CustomerPayment` | 0 |
>
> **Two real sales, one customer.** Session briefs have now described **5 sales across 3 customers**
> seven times, and no query has ever reproduced it. Do not run a delete set sized from the wrong
> environment, and do not treat "only 1 row in `Sale`" as data loss — it is correct.

#### `[ ]` **2b. [BLOCKS GO-LIVE] Owner sets his real shop details in Settings**

**Status:** open. **The Settings table and screen SHIPPED 2026-08-10** (`/settings`, migration
`20260810120000_add_settings`) — what remains is the owner typing his own details in. Sits with #2
deliberately: both are "the owner's real data replaces our build-time stand-ins", and they are done
in the same sitting at handoff.

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

- **`shopName` = 32** is not a taste judgement, it is one line of a 58mm receipt
  (`RECEIPT_LINE_CHARS`). If the paper width is ever confirmed as 80mm, change that constant to 48
  and this cap follows — do not edit the cap directly.
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

#### `[~]` **4. Unified `Sale` build** — API, `/sales` form + edit UI, redirects, line-level reports

**PARTLY SHIPPED — updated 2026-08-13.** ~~NOT STARTED.~~ The API half is done and live.

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
   `/receipt/sale/[id]`, and the receivables bridge. ⚠️ **A unified sale is STILL invisible to
   REPORTS and the CSV export** (`lib/reports.ts` reads the old tables) — that is S6 / item #6.
2. ~~The milk cutover~~ ✅ **SHIPPED in S4.3.** Milk sells on the till; `/milk/sales` is a history
   screen that can no longer create one; `POST /api/milk/sales` is unreachable and retires at S9.
   **Milk stock is authoritative** — see the "🥛 Milk stock" section for the opening-number caveat.
3. ~~A unified sale DELETE that restores stock~~ ✅ **SHIPPED in S4.1.**
   `DELETE /api/sales/[id]` restores every line's quantity through the same
   `computeStockDeltas`/`applyStockDeltas` pair the per-module routes use, in one transaction.
   **The unified EDIT (PATCH) is still open** and lands with the screen — CHECKLIST #8.
4. Old routes redirecting, and reports rewritten to `Σ netLineTotal` by `moduleKey` (that half is
   tracked as #6 / S6 — reports still group by `beverageSaleItem` / `bakerySaleItem`,
   `lib/reports.ts:217,224`).

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
scoping it as "one `ALTER TABLE`, no code" would have got a red build. Analysed 2026-08-12 (evidence:
`docs/responses/2026-08-12-INCIDENT-live-database-wiped-by-shadow-db-flag.md`).

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

#### `[ ]` **5. Migration B** — drop `BeverageSale`, `BeverageSaleItem`, `BakerySale`, `BakerySaleItem`

**NOT WRITTEN, NOT RUN.** The point of no return. **Gated on #4 being built AND browser-verified**
— the old tables are the only copy left to reconcile against, and the one real sale currently lives
in one of them. See the data-count warning under #2 before dropping anything.

#### `[~]` **6. `lib/receivables.ts` — now sums the UNIFIED `Sale` TOO (S4.2), old tables still there**

> **UPDATED 2026-08-14.** Receivables counts `BeverageSale` + `BakerySale` + `MilkSale` **+ `Sale`**,
> so a unified bill reaches the customer's balance. **Migration A's copy is excluded by id** —
> `NOT_A_MIGRATION_COPY` in `lib/receivables.ts`. Without it Saif reads 16,000 instead of 11,000,
> because the `Sale` row carries the SAME id as the `BakerySale` row it was copied from. The filter
> is self-healing (1 row today, 0 after S5) — do not remove it before S5.
>
> **`lib/reports.ts` is the part that has NOT moved**: revenue, counts, trend and top products still
> read the old tables only, so unified sales are missing from every report figure. That is S6.
>
> The original note below still describes the old-table dependency Migration B has to deal with.

**"Dormant" understates it — corrected 2026-08-11.** Receivables was removed from the **UI** in
batch 2, not from the **code**. The module has **16 Prisma calls** (8 of them against the old sale
tables) and is imported by **8 route files**: `/api/customers`, `/api/customers/[id]`,
`/api/customers/[id]/balance`, `/api/customers/[id]/payments`,
`/api/customers/[id]/payments/[paymentId]`, `/api/milk/sales`, `/api/milk/sales/[id]`,
`/api/reports/export`. It runs on every customer and milk-sale request.

What *is* dormant is its presentation: `CustomerProfile` and `CustomersHub` no longer render
billed/paid/outstanding, and `PaymentDialog` is defined but **never rendered** — as is
`useDeactivateCustomer`. So the balances are computed and returned, and nothing displays them.

**Migration B would leave 8 live routes referencing dropped tables.** Repoint at `Sale` or delete
it, as part of #5. Deleting is only safe once the `CustomerPayment` table and the payments routes
go with it — decide that deliberately rather than discovering it at drop time.

#### `[x]` **7. Harden the client `unitPrice` override on UPDATE — CLOSED 2026-08-11**

Shipped. The update branch of `reconcileSaleLines()` no longer reads `line.unitPrice`; an existing
line's price is `productChanged ? product.price : prior.unitPrice`. The override survives on
**create** only. Full reasoning and the asymmetry rule: **Price snapshot → the create/update
asymmetry note**.

**Fixed deliberately BEFORE #8 (the sale edit UI) exists**, while the PATCH route had zero callers
and the change could not regress anything. Verified over authenticated HTTP: a bogus client
`unitPrice` on a quantity-only PATCH was ignored and the stored snapshot preserved.

#### `[ ]` **8. Sale edit UI for beverages/bakery**

The `PATCH` route is complete, stock- and discount-aware and server-verified; **there is no
screen.** Lands WITH #4, deliberately — an edit screen written against the current per-module
structure would be built to be thrown away. See the carried-forward "PATCH has no UI" note before
assuming it is dead code.

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
`3 × Rs. 276  Rs. 744`. Evidence:
`docs/responses/2026-08-10-discount-column-dropped-and-verified.md`.

#### `[ ]` **10. Touch targets — app-wide, in one place**

`shadcn TabsTrigger` measures **28px** and inline back-links **20px** against the Design System's
**44px** minimum (measured on the customer profile at 360px). These are framework/text defaults,
not one-off mistakes, so they exist wherever those primitives are used.

**Do NOT patch piecemeal as they turn up.** Override the defaults **once** in the primitives.

⚠️ **CORRECTED 2026-08-11 — the primitive defaults are 36px, not ≥44px.** An earlier version of
this item said "everything else measured clean — inputs, buttons and cards are all ≥44px". That is
**false**, read straight from the cva:

| Primitive | Default | |
|---|---|---|
| `components/ui/button.tsx` | `default: "h-9 px-4 py-2"` | **36px** (also `sm` h-8 = 32px, `lg` h-10 = 40px, `icon` h-9) |
| `components/ui/input.tsx` | `"flex h-9 w-full …"` | **36px** |
| `components/ui/tabs.tsx` | `TabsList` `h-9` + `p-1`; `TabsTrigger` has **no height**, only `px-3 py-1 text-sm` | **≈28px** |

They reach 44px only where a call site overrides with `h-11` — **151 such overrides exist**, while
**~84 `<Button>` and ~40 `<Input>` usages carry no override** and render at 36px. So the scope is
the three primitive defaults, not one `TabsTrigger` line.

#### `[ ]` **11. PWA — manifest, service worker, install prompt**

**`start_url` and `scope` must BOTH be `"/"`.** The app is served at the root; `(dashboard)` is a
layout group contributing nothing to the URL, and no `/dashboard` route exists. A wrong `start_url`
**404s every installed home-screen launch and only breaks after install** — easy to miss, because
it cannot be seen in the browser.

#### `[ ]` **12. Native date input locale — `DD/MM/YYYY` consistency**

The Design System specifies `DD/MM/YYYY`. Confirm every date **input** as well as every display
honours it — a native `<input type="date">` renders in the *device's* locale, which is not
something the formatter controls. Check alongside Asia/Karachi day bucketing (Gotcha 4).

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

#### `[ ]` **17. Cooling / chilling charge — per product, set by the owner**

A per-product catalog field for the cooling charge, **set by the owner himself and independently for
EACH beverage size** — a 1.5L and a 2.25L do not carry the same charge, so one global rate would be
wrong for every size but one.

At billing: a **toggle** (this sale is chilled / not) plus a **rate override**, defaulting to the
catalog value. Same shape as the price override in #18 — the catalog holds the usual number, the bill
can depart from it, and what was actually charged is snapshotted on the line.

**Placeholder values until handover.**

#### `[ ]` **18. Billing-time price override on EVERY product (whole inventory)**

An optional field on the bill to type an updated price when the catalog price has not been refreshed
yet. Prices move faster than the owner can walk the catalog, and today he has to leave the sale to
fix one.

**The API already supports this** — `snapshotUnitPrice` honours an explicit `unitPrice` on CREATE,
and the unified `POST /api/sales` accepts it. **This item is the UI field only.**

⚠️ **CREATE ONLY.** The override must never reach an edit: `reconcileSaleLines` deliberately ignores
a client `unitPrice` for an existing line (CHECKLIST #7, closed 2026-08-11), because honouring it
would let a closed bill be silently re-priced. See the create/update asymmetry under **Price
snapshot**.

#### `[ ]` **19. Multi-unit products — ONE stock pool, several selling units**

The same physical goods sell in more than one unit, and **stock must be a single shared pool** or the
two units drift apart and oversell each other.

| Product | Units | Prices (placeholder) |
|---|---|---|
| **Eggs** | dozen · tray (**30**) · peti (**360** = 12 trays) | 200 / 500 / 7000 |
| **Beverages** | single bottle · pet | per size |

**🔴 LOCAL QUARTER = 12 BOTTLES PER PET, NOT 24.** Write it down because every reference table says
24 and the owner's is 12. **Bottles-per-pet is PER SIZE**, so it is a per-product number, not a
constant.

Selling one peti must decrement the shared egg pool by 360 — which is why `Product.stock` being
`Decimal` (Migration D) and quantity being `Decimal` (Migration C) already fit: a conversion factor
lands on the line, not on a second stock column.

**Placeholder prices until handover.**

#### `[ ]` **20. Per-product sales visibility in reporting**

Reports currently answer "how much did Beverages sell". The owner also needs **each product's units
sold**, not just per-category — and **milk shown as its own line**.

Lands with the S6 reporting repoint (#6): once revenue is `Σ netLineTotal` grouped by
`SaleItem.moduleKey`, grouping by `productId` is the same query shape, and `moduleKey` is what lets
milk appear as its own line rather than being folded into a category.

---

### ⚪ Handoff infra

#### `[ ]` **14. Region co-location — the function and the database are on different continents**

**Do not fix mid-build. Do it at go-live, with the Pro upgrade.** Measured on a real deployment,
not inferred:

| | |
|---|---|
| Serverless function region | **`iad1` — Washington DC** |
| Supabase region | **`ap-northeast-2` — Seoul** |
| Distance | ~11,000 km, every single query |

`X-Vercel-Id: bom1::iad1::…` — the first segment is only the edge PoP that accepted the request
(Mumbai, nearest to Pakistan); the second is where the function actually ran.

**This is the ~1.1s/query floor, and it is not a dev-machine artifact.** Measured warm against the
deployed function: `/api/reports/summary` (1 query) **~1.75s**; `/api/reports/balances` (6 queries)
**~6.4s ≈ 1.07s per query**. Production is no faster than local.

**The fix:** set the project's function region to `icn1` (Seoul), or move the Supabase project near
`iad1`. **Single highest-value performance change available** — everything else in the app is a
workaround for it (see "One database round trip costs ~1.1s" in API Route Conventions, and the
progressive load on `/reports`).

#### `[ ]` **15. Data API surface — an owner decision, not a leak**

`anon` / `authenticated` retain table-level GRANTs on all 18 tables (Supabase's default for
`public`). RLS makes those grants useless for reading rows, so this is **not** a leak — but the
PostgREST surface still exists. Restricting the exposed schemas or disabling the Data API is
pending the owner's call; it would not affect Prisma, which never goes through PostgREST.

#### `[ ]` **16. Two applied migrations are UNTRACKED in git — found 2026-08-11**

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