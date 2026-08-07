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

## Development Phases

| Phase | Scope | Status |
|---|---|---|
| 1  | Scaffold + Prisma schema + split-config auth + Vercel deploy | ✅ Done |
| 2  | Category & product manager (CRUD + inline price editor) + seed | ✅ Done |
| 3  | Beverages module (multi-item sales, list, customer ledger) | ✅ Done |
| 4  | Bakery module (mirrors beverages) | ✅ Done |
| 4b | Customers hub + receivables (payments, outstanding balances) | ✅ Done |
| 5  | Milk shop: farmers, deliveries, purchases, quick-entry, milk sales | ⬜ Todo |
| 6  | Farmer net-balance ledger + all-farmers balance sheet | ⬜ Todo |
| 7  | Reports dashboard + charts + CSV export | ⬜ Todo |
| 8  | Polish: mobile nav, states, a11y, PWA, final validation | ⬜ Todo |

Update this table as phases complete. Change ⬜ to ✅.

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
    **The 409 path has never fired outside a test fixture** (it needs real sale history), so
    re-test it for real once beverage/bakery sales exist.
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
  - **The delete-guard 409 / soft-delete re-test is still outstanding.** Real sale history now
    exists in the code paths but the test DB was reset, so it needs sales re-created first.
    Procedure: `docs/phase-3.1-beverages-api.md` §6.
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
- **Phase 8 (PWA):** `start_url` and `scope` must both be `"/"`. Full reasoning in the
  **Deployment posture** section above — single source of truth, don't duplicate it here.

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