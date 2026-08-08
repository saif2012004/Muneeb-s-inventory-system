# CLAUDE.md - Business Management App
# Pepsi Agency · Bakery · Milk Shop

> Place this file at the ROOT of the project repo.
> Claude Code reads it automatically at the start of every session.
> Keep it updated as the schema or business rules evolve.

---

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
- Stat numbers: count-up on mount (respect the value type, format after animating).
- Dialogs/sheets: spring scale/slide via AnimatePresence.
- List rows: `layout` animation when items are added/removed.
- **Always respect `prefers-reduced-motion`** and disable non-essential animation when set.

### Component quality bar
- Use shadcn/ui for every primitive. Do not hand-build inputs, tables, dialogs, or selects.
- Every list/table has three states designed: loading (Skeleton), empty (friendly message + primary action, e.g. "No sales yet. Add your first sale."), and error (retry).
- Every destructive action has a confirm dialog.
- Every form submit button shows a spinner and disables while pending.
- Toast on every create/update/delete (success and error).

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
/prisma
  schema.prisma           → single source of truth
  seed.ts                 → initial products
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
  discountPercent Int?         // 0 | 20 | 30 | 60
  qualityTier     String?      // "premium" | "simple" | null
  shape           String?      // "circle" | "rectangular_round" | null (russ)
  unit            String?      // "cotton" (eggs) | "piece" | "bottle" | null
  isActive        Boolean      @default(true)
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  // REQUIRED back-relations (do not remove, migration fails without them)
  beverageSaleItems BeverageSaleItem[]
  bakerySaleItems   BakerySaleItem[]
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

**Exactly when a line re-snapshots the current price (decided Phase 3.1 — do not loosen):**

| Edit to a line | Price behaviour |
|---|---|
| New line added | **Re-snapshot** — copy current `product.price` |
| Line's `productId` changed | **Re-snapshot** — it is a different item, the old price is meaningless for it |
| Line's `quantity` changed, same product | **KEEP the stored `unitPrice`** |
| Line untouched | **KEEP the stored `unitPrice`** |
| Explicit `unitPrice` sent for the line | That value wins over every row above |

**Quantity is NOT a re-price trigger, deliberately.** Correcting "12 crates" to "15" on a
months-old sale is a typo fix, not a re-sale; re-pricing it at today's catalog price would
silently move a historical total the owner never asked to change. An earlier draft of this
rule said "any changed line re-snapshots" — that was rejected on review. Do not restore it.

The decision is implemented ONCE, in `reconcileSaleLines()` in `lib/sales.ts`, as a pure
function so it can be tested without HTTP. Beverages uses it; Bakery (Phase 4) must reuse it
rather than re-implement the predicate. Sale PATCH responses return `repricedItemIds` so the
UI can show which lines genuinely took a new price.

### Discounts, russ, eggs
- Discount variants (20/30/60%) are separate Product records with the discounted price stored directly. No runtime discount math.
- Russ = 2 sizes (large/small) x 2 shapes (circle/rectangular_round) = 4 products, differentiated by `size` and `shape`.
- Eggs sold by the cotton: `unit: "cotton"`, quantity = number of cottons.

### Out of scope (do not build unless asked)
- Physical stock / inventory counts (no stock table). The app tracks sales and prices, not remaining quantity on hand.
- Multi-user roles, supplier invoicing, tax/GST.

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

### 🔴 OPEN SECURITY ITEM — login form falls back to a GET with credentials in the URL

**MUST FIX before client handoff. Do not close Phase 8 with this outstanding.**

**Symptom.** When the client JS bundle is absent or has not hydrated, the login form submits
NATIVELY. There is no `method` on the `<form>`, so the browser defaults to **GET**, and the
email and password land in the query string:

```
/login?email=owner%40example.com&password=<the actual password>
```

**Why it matters.** A password in a URL is not a cosmetic problem — it is written to browser
history, server and proxy access logs, and any `Referer` header sent onward. Those are places
credentials are never rotated out of, and the owner reuses passwords like everyone else.

**Status.** Found during Phase 5 mobile verification (2026-08-08) and **reproduced**: the URL
above is what the address bar actually showed. It only appeared while every client chunk was
404ing from a corrupted `.next` (see the dev-server note below), and it did NOT recur once
the chunks served 200 — so in normal operation the React `onSubmit` handler intercepts and
this path is not taken. It is a **degraded-state** exposure, not an everyday one.

That is a reason to schedule it, not to dismiss it: "only when JS fails" still includes a
failed deploy, a CDN hiccup, an ad-blocker or a locked-down corporate browser — exactly the
moments a user retypes their password.

**The fix (not applied yet — deliberately deferred, Phase 1 code, out of Phase 5 scope):**
the login form must never be capable of sending credentials via GET.
- Put `method="post"` on the `<form>` so the no-JS fallback can never serialise fields into
  the URL, and
- ensure the no-JS path cannot post credentials anywhere that isn't a real handler — prefer
  a server action / route that accepts POST only, and reject non-POST outright.
- Re-test with JavaScript disabled in the browser, not just with JS working. The bug is
  invisible in the working case.

Owner: whoever picks up Phase 8, or a standalone task before handoff. **Do not let this get
lost in the a11y sweep.**

---

## Database security (READ BEFORE TOUCHING RLS)

**Row Level Security is ENABLED on all 15 tables in `public`, with ZERO policies. This is
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
  That role has `rolbypassrls = true` **and** owns all 15 tables — two independent reasons RLS
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

`get_advisors({ type: "security" })` reports 15 × `rls_enabled_no_policy` at **INFO** level.
That is the healthy steady state, not a regression. The thing to watch for is
`rls_disabled_in_public` at **ERROR** level — that means a new table slipped through.

### Still open

`anon` / `authenticated` retain table-level GRANTs on all 15 tables (Supabase's default for
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

---

## Deployment posture (DECIDED — do not re-litigate each session)

**Vercel plan: stay on Hobby for the whole build phase. Deploy to it freely.**
No client is using the app and there is no real business data, so Hobby is fine and no
upgrade is pending work. Do not raise it as a blocker on every deploy.

**Upgrade to Vercel Pro at CLIENT HANDOFF — event-triggered, not date-triggered.**
The trigger is: *the client starts entering real records and relying on the app for daily
use.* Upgrade **before** that moment, never after. Two independent reasons:
1. **Terms** — Vercel Hobby forbids commercial use. Once it is a live business tool, Hobby
   is a terms violation, and enforcement would hit the system the client runs their books on.
2. **Headroom** — Pro raises function duration/size limits and concurrency. Hobby's limits
   are fine for an idle build-phase app and not something to discover under live load.

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
Manifest `start_url` must be **`"/"`**, and `scope: "/"`. The app is served at the root;
`(dashboard)` is a layout group that contributes nothing to the URL, and no `/dashboard`
route exists. A wrong `start_url` 404s every installed home-screen launch, and only breaks
after install — easy to miss.

### Still true regardless of plan
- **Supabase free tier pauses after 7 days of inactivity and keeps zero backups.** For real
  financial data use **Supabase Pro (~$25/mo)** — removes the pause, adds daily backups — OR
  at minimum a scheduled keep-alive ping plus a weekly DB export. Do not ship a business's
  money records on a zero-backup tier. Same handoff trigger as the Vercel upgrade.
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
| 8  | Polish: mobile nav, states, a11y, PWA, **login POST-only security fix**, final validation | ⬜ Todo |

Update this table as phases complete. Change ⬜ to ✅.

**Phase 8 cannot be marked ✅ while the login GET-fallback is unfixed.** It is a real
credential-exposure path (email + password in the URL when JS is absent) and is written up in
full in the Authentication section above. Fix it as its own task before handoff, or inside
Phase 8 — but it is a blocker for closing the phase, not a nice-to-have.

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
- **Phase 8 (PWA):** `start_url` and `scope` must both be `"/"`. Full reasoning in the
  **Deployment posture** section above — single source of truth, don't duplicate it here.
- **Phase 8 (touch targets) — QUEUED, found in 4b:** several controls sit under the Design
  System's 44px minimum. Measured on the customer profile at 360px: **shadcn `TabsTrigger` is
  28px** and the **"All customers" back link is 20px**. These are framework/text defaults rather
  than one-off mistakes, so the same undersized tabs and inline links will exist wherever they
  are used — Phase 5's milk tabs will inherit it too. **Do NOT patch these piecemeal as they
  turn up.** Raise them app-wide in the a11y/mobile sweep, ideally by overriding the `TabsTrigger`
  default once in `components/ui/tabs.tsx` rather than per usage. Everything else measured
  clean: inputs, buttons and cards are all ≥44px.

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