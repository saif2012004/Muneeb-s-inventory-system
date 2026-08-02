# Phase 2.1 — Catalog API Routes

**Status:** Complete and verified (33/33, run twice)
**Date:** 2026-08-03
**Scope:** Category / SubCategory / Product CRUD with guarded deletes. No UI, no seed run.

---

## 1. Seed correction

Milk Shop category dropped from `prisma/seed.ts`, with a comment recording *why* so it does not
get re-added: milk is modelled in its own tables (`MilkDelivery`, `FarmerPurchase`, `MilkSale`)
by liters × rate, never as a catalog Product. The catalog is Beverages + Bakery only.

**Revised seed totals:**

| | Before | After |
|---|---:|---:|
| Categories | 3 | **2** |
| Sub-categories | 11 | **11** |
| Products | 62 | **62** |

Sub-category and product counts are unchanged — the dropped category was empty.

Per-sub-category breakdown is unchanged:

| Category | Sub-category | Products | Breakdown |
|---|---|---:|---|
| Beverages | Pepsi | 16 | 4 sizes × 4 tiers (full/20/30/60) |
| Beverages | Coke Cola | 16 | 4 sizes × 4 tiers |
| Beverages | Gourmet | 16 | 4 sizes × 4 tiers |
| Beverages | Juice | 2 | 0.5L, 1L — no discount variants |
| Beverages | Big Apple | 1 | no sizes |
| Beverages | Big Lychee | 1 | no sizes |
| Bakery | Cake Rusk | 2 | Premium, Simple |
| Bakery | Buns | 1 | |
| Bakery | Biscuits | 2 | Premium, Simple |
| Bakery | Russ | 4 | 2 sizes × 2 shapes |
| Bakery | Eggs | 1 | `unit: "cotton"` |
| | **11** | **62** | |

Approved sign-offs carried in: unit defaults (`bottle` / `piece` / `cotton`), and `0.5L` as the
display label everywhere while `half_litre` remains the stored value.

---

## 2. Files delivered

### Route handlers

| Route | Methods |
|---|---|
| `app/api/categories/route.ts` | `GET` (tree + product counts), `POST` |
| `app/api/categories/[id]/route.ts` | `PATCH` (rename), `DELETE` (guarded) |
| `app/api/subcategories/route.ts` | `POST` |
| `app/api/subcategories/[id]/route.ts` | `PATCH` (rename/move), `DELETE` (guarded) |
| `app/api/products/route.ts` | `GET` (filters + `includeInactive`), `POST` |
| `app/api/products/[id]/route.ts` | `PATCH` (incl. price-only), `DELETE` (soft/hard) |

Every route carries `export const runtime = "nodejs"` (Prisma cannot run on Edge) and
`export const dynamic = "force-dynamic"`, checks the session with `auth()` first, validates with
zod before touching Prisma, and returns the `{ data, error }` shape.

### Supporting modules

- **`lib/api.ts`** — `ok()` / `fail()` / `serverError()` / `requireOwner()` / `firstIssue()`.
  `requireOwner()` uses Auth.js v5 `auth()`, never `getServerSession`. `serverError()` logs the
  real error server-side and returns a generic message, so raw Prisma errors never leak.
- **`lib/validations/catalog.ts`** — zod schemas plus the string unions mirroring the `Product`
  comments in `schema.prisma` (sizes, discount tiers, quality tiers, shapes, units) and
  `SIZE_LABELS` for display.
- **`lib/catalog-guards.ts`** — **one** implementation of the delete rule, shared by all three
  levels so the behaviour cannot drift between them.

---

## 3. The delete rule

Sale history is sacred. A `BeverageSaleItem` / `BakerySaleItem` holds a price snapshot taken at
the time of sale (Gotcha 5), and a past sale must stay readable forever. Nothing a sale line
points at is ever hard-deleted.

| Level | Behaviour |
|---|---|
| **Product** | Soft-delete (`isActive = false`) if it has sale history; hard-delete only when clean. |
| **SubCategory** | Hard-delete only if nothing beneath it has sale history. Clean children go with it in one transaction. Otherwise **409 refuse**. |
| **Category** | Same rule, one level up. Clean sub-categories and their products go with it in one transaction. Otherwise **409 refuse**. |

There is deliberately no cascade path that could reach a sale row. `SubCategory.category` is
declared `onDelete: Cascade` in `schema.prisma`, which is exactly why every delete is an
explicit, ordered transaction rather than a single `category.delete()` — the database is never
allowed to decide what goes.

The 409 message names up to three blocking products and tells the owner what to do instead:

> Can't delete "Pepsi" — 3 products have sales recorded against it (Pepsi 1.5L, Pepsi 1L and 2
> more). Deactivate those products instead so past sales stay intact.

---

## 4. Verification — 33/33, run twice

Run against the empty database using a session cookie minted from `NEXTAUTH_SECRET`, so the
authenticated paths were genuinely exercised rather than only the 401 rejections.

| Group | Checks |
|---|---|
| Session + empty state | authenticated `GET` returns 200; catalog starts empty |
| Validation | blank name → 400; invalid size enum → 400; negative price → 400; `{data:null,error}` shape on failure |
| Create | category → 201; case-insensitive duplicate → 409; sub-category → 201; bad `categoryId` → **404, not a raw FK error** |
| Decimal serialization | `price` returns as JSON **number** (`123.45`), not a Decimal object — Gotcha 2 holds |
| Inline price editor | `PATCH { price }` alone → 200; unknown id → 404 |
| **Guarded deletes** | sub-category with a sold product → **409**; category above it → **409**; refusal names the product; refusal says "Deactivate"; **refused deletes destroyed nothing** (products and sale lines verified intact after) |
| Product soft/hard | with history → soft, row survives `isActive=false`, sale line still resolves; clean → hard, row gone |
| Inactive toggle | default list hides deactivated; `includeInactive=true` shows it; reactivate works |
| Clean-up path | once history removed, category delete → 200 reporting `deletedSubCategories: 1, deletedProducts: 1`; children verified gone |

### Database was left exactly as found

The verification wrote throwaway `ZZ_VERIFY`-prefixed rows — including a `Customer` and a
`BeverageSale` with a line item, the only way to prove the guard actually refuses — and removed
every one in a `finally` block. Independently reconfirmed via Supabase MCP afterwards:

- All 14 data tables at **0 rows**; `User` at **1** (the owner)
- `_prisma_migrations` still at **2** — no migration ran
- No new tables, so no new `ENABLE ROW LEVEL SECURITY` statement was needed
- RLS still enabled on all 15 tables

The temporary verifier script has been deleted.

---

## 5. Two open decisions

### 5.1 `lib/auth.config.ts` was modified — a file CLAUDE.md treats as settled

**Problem found:** signed-out API calls returned a **307 redirect to the HTML login page**. A
`fetch()` from the 2.2 UI follows that redirect silently, receives HTML, and then dies inside
`res.json()` with an opaque parse error instead of surfacing "your session expired".

**Change made:** in the `authorized` callback, requests under `/api/` now receive
`401 {"data":null,"error":"You must be signed in."}`. Page requests still redirect to `/login`.
Both behaviours were verified.

The change is additive and does not weaken the middleware matcher — but it touches a decided
area, so it needs an explicit keep/revert call.

### 5.2 `npm run build` is broken on this machine — pre-existing, not from these changes

> **SUPERSEDED — see `docs/phase-2.1-deploy-verification.md` §3.** "Broken" was too strong.
> The build OOMs only under memory pressure; with the dev server stopped it completes
> locally and emits the same `ƒ Middleware 78.2 kB` as Vercel. The Edge-bundle check was
> subsequently run against a real production bundle and came back **clean**.

Confirmed by stashing all Phase 2 work and building clean `main`: it OOMs identically
(`FATAL ERROR: Zone Allocation failed`, worker exit code 134). The machine has ~15 GB total with
only ~2 GB free.

**Consequences:**

- The 13 failures seen on the first verification run were this same OOM killing route-compilation
  workers — **not route bugs**. They vanished at 33/33 once memory was freed and the server
  restarted.
- **The Gotcha 3 Edge-bundle check could not be run locally**
  (`Select-String -Path .next/server/middleware.js -Pattern '@prisma/client|bcryptjs'`), because
  the build never produces the file. The `auth.config.ts` edit uses `NextResponse`, which was
  already imported in that file, so it introduces no new dependency into the Edge bundle — but
  the documented check remains unverified locally. Vercel built Phase 1 successfully, so a
  preview deploy would confirm it.

---

## 6. Not done

- **2.2** — catalog UI (add/rename dialogs at all three levels, delete confirm dialogs, graceful
  "deactivate instead" handling of a 409, "show inactive" toggle).
- **2.3** — running the seed. **Nothing has been seeded.** `prisma/seed.ts` and the
  `package.json` wiring (`prisma.seed` + `npm run seed`) exist but have never been executed.

---

## 7. Working tree at time of writing

```
 M lib/auth.config.ts        # 401 JSON for /api/ (decision 5.1)
 M package.json              # prisma.seed key + npm run seed
?? app/api/categories/
?? app/api/products/
?? app/api/subcategories/
?? lib/api.ts
?? lib/catalog-guards.ts
?? lib/validations/catalog.ts
?? prisma/seed.ts
```

Nothing committed. `npx tsc --noEmit` passes clean.
