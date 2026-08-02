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

```
/app
  /api                     → Route Handlers (serverless). runtime="nodejs" where Prisma/bcrypt used.
  /(auth)/login            → Owner login page
  /(dashboard)
    /layout.tsx            → Protected layout with nav
    /page.tsx             → Dashboard home (summary + charts)
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
- Editing a sale is allowed, but on edit re-snapshot the current price for any changed/added line and recompute totals inside a transaction. Do not silently rewrite unchanged historical lines.

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
- Split config (see Gotcha 3). Middleware protects all `/dashboard` routes.
- One-time `/scripts/create-owner.ts` seeds the owner account.

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

## Deployment & Ops Reality (tell the client upfront)
- **Vercel Hobby (free) forbids commercial use.** A client business app must run on **Vercel Pro (~$20/mo)**. Budget for it.
- **Supabase free tier pauses after 7 days of inactivity and keeps zero backups.** For real financial data, use **Supabase Pro (~$25/mo)** which removes the pause and adds daily backups, OR at minimum set up a scheduled keep-alive ping and a weekly DB export. Do not ship a business's money records on a zero-backup tier.
- Prisma on Vercel: run `prisma generate` in the build step (`postinstall` or build command), use the pooled `DATABASE_URL` at runtime and `DIRECT_URL` only for migrations.

---

## Development Phases

| Phase | Scope | Status |
|---|---|---|
| 1  | Scaffold + Prisma schema + split-config auth + Vercel deploy | ⬜ Todo |
| 2  | Category & product manager (CRUD + inline price editor) + seed | ⬜ Todo |
| 3  | Beverages module (multi-item sales, list, customer ledger) | ⬜ Todo |
| 4  | Bakery module (mirrors beverages) | ⬜ Todo |
| 4b | Customers hub + receivables (payments, outstanding balances) | ⬜ Todo |
| 5  | Milk shop: farmers, deliveries, purchases, quick-entry, milk sales | ⬜ Todo |
| 6  | Farmer net-balance ledger + all-farmers balance sheet | ⬜ Todo |
| 7  | Reports dashboard + charts + CSV export | ⬜ Todo |
| 8  | Polish: mobile nav, states, a11y, PWA, final validation | ⬜ Todo |

Update this table as phases complete. Change ⬜ to ✅.

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