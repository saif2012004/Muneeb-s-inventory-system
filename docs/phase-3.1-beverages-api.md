# Phase 3.1 — Beverages sale API routes

**Status:** reviewed, snapshot rule amended (§3.1), type-checked, lint-clean, committed.
**Scope:** API routes only. No UI, no schema change, no migration run.

---

## 1. Pre-flight checks

### 1.1 Supabase MCP — real columns confirmed (read-only)

Queried `information_schema.columns` before writing anything. All three tables match
`schema.prisma` exactly:

| `Customer` | `BeverageSale` | `BeverageSaleItem` |
|---|---|---|
| `id` text NOT NULL | `id` text NOT NULL | `id` text NOT NULL |
| `name` text NOT NULL | `customerId` text NOT NULL | `saleId` text NOT NULL |
| `phone` text NULL | `saleDate` timestamp NOT NULL, default `CURRENT_TIMESTAMP` | `productId` text NOT NULL |
| `type` text NOT NULL | `totalAmount` numeric(10,2) NOT NULL | `quantity` integer NOT NULL |
| `isActive` boolean NOT NULL, default `true` | `notes` text NULL | `unitPrice` numeric(10,2) NOT NULL |
| `createdAt` timestamp NOT NULL, default `CURRENT_TIMESTAMP` | `createdAt` timestamp NOT NULL, default `CURRENT_TIMESTAMP` | `lineTotal` numeric(10,2) NOT NULL |

Two things worth noting from that check:

- `saleDate` is `timestamp without time zone`. Postgres stores no offset, so the
  Karachi/UTC discipline (Gotcha 4) is entirely the application's job — nothing in the
  database will catch a wrong-day bucket. This is handled in `lib/validations/sales.ts`.
- Every money column is `numeric(10,2)` → hard ceiling **99,999,999.99**. A total above it
  throws inside Prisma, so the routes guard the bound and return a sentence instead
  (`checkTotalFits` in `lib/sales.ts`).

Current state of the data: **0 customers, 0 beverage sales, 0 sale items.** The catalog is
seeded (52 Beverages products under `cat_beverages`, 10 Bakery under `cat_bakery`, all at
`price 0.00`).

### 1.2 Context7 — NOT AVAILABLE, please read this

**The Context7 MCP server is not connected in this session.** I checked the tool registry:
Supabase, Vercel, Figma, Chrome and IDE servers are present; there is no Context7. The
session rule "pull fresh Prisma 6 docs before coding" could not be satisfied as written.

What I did instead, so you can judge the risk:

- Used the **existing Phase 2 routes as the in-repo pattern of record** — `lib/api.ts`,
  `app/api/products/route.ts` and `lib/catalog-guards.ts` are already-reviewed, already-
  deployed Prisma 6 code. The new routes copy their idioms exactly rather than inventing any.
- Confirmed the installed version directly: `@prisma/client` **6.19.3**. No v7 pattern is
  used anywhere — no generated output path, no driver adapter, no `prisma.config.ts`,
  `import { PrismaClient } from "@prisma/client"` only.
- The only Prisma APIs used beyond what Phase 2 already exercises are
  `$transaction([...])` (array form, for the paged list) and `$transaction(async tx => …)`
  (interactive form, for the PATCH reconciliation). Both are long-stable v6 APIs and both
  are verified against a real type-check.

**Recommend reconnecting Context7 before 3.2**, since the UI work touches shadcn and
TanStack Query, where the API surface moves faster than Prisma's.

---

## 2. Files

| File | New? | What it is |
|---|---|---|
| `lib/modules.ts` | new | Maps a module → its catalog `Category`. Seeded-id first, case-insensitive name fallback. |
| `lib/sales.ts` | new | Shared money + line mechanics: product validation, price snapshot, Decimal maths, the shared `SALE_DETAIL_SELECT`. Bakery (Phase 4) reuses it unchanged. |
| `lib/validations/sales.ts` | new | Zod schemas for create / update / list. Karachi date transform lives here. |
| `lib/validations/customers.ts` | new | Customer create schema + type labels. |
| `app/api/beverages/sales/route.ts` | new | `GET` list (filtered, paged), `POST` create. |
| `app/api/beverages/sales/[id]/route.ts` | new | `GET` one, `PATCH` edit, `DELETE`. |
| `app/api/customers/route.ts` | new | `GET` list, `POST` create. Minimal — no receivables. |

**Nothing existing was modified.** `git status` shows only additions.

Every route has `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `requireOwner()` as the
first statement, zod validation before Prisma, `{ data, error }` responses, `serialize()` on
anything carrying a Decimal, and `serverError()` in the catch so a raw Prisma error can
never reach the owner.

---

## 3. Decisions you should sanity-check

These are the places where the prompt left room and I made a call. Three of them are worth
a deliberate yes/no from you.

### 3.1 Re-snapshot trigger — RESOLVED, quantity no longer re-prices

The first draft followed the older wording literally: *any changed or added line
re-snapshots*. That meant a quantity-only correction on an old sale re-priced the line at
today's catalog price and moved a historical total. **Reviewed and changed.** The rule is
now:

| Edit to a line | Price behaviour |
|---|---|
| New line added | **Re-snapshot** current `product.price` |
| Line's `productId` changed | **Re-snapshot** — different item, old price is meaningless for it |
| Line's `quantity` changed, same product | **KEEPS** its stored `unitPrice` |
| Line untouched | **KEEPS** its stored `unitPrice` |
| Explicit `unitPrice` sent | That value wins over all of the above |

Implemented once, in **`reconcileSaleLines()` in `lib/sales.ts`** — extracted out of the
route as a pure function so the snapshot rule can be tested directly rather than inferred
from an HTTP response, and so Phase 4 Bakery reuses the predicate instead of re-writing it.
`repricedItemIds` in the PATCH response now reports only genuine re-prices (product change
or new line).

`CLAUDE.md`'s "Price snapshot" section has been rewritten with the table above and an
explicit note that the earlier "any changed line" wording was rejected on review, so it does
not drift back.

### 3.2 Sales against deactivated products are refused

A product deactivated in the catalog cannot be added to a **new** sale — 400 with
*"…is deactivated and can't be added to a new sale. Reactivate it in the catalog first."*
Deactivation exists precisely to mean "we don't sell this any more", so honouring it here
seemed right. Past sales containing it are of course untouched and still render its name.

### 3.3 Module ownership is enforced, not assumed

Nothing in the schema stops a Bakery product landing on a beverage sale — the FK only
requires *some* product. So both write paths resolve the Beverages category and reject
foreign products with *"X is not a Beverages product…"* (400). Resolution is
`cat_beverages` by id first, then a case-insensitive `name = 'Beverages'` fallback, so the
owner renaming or recreating the category does not break the module.

I deliberately did **not** import `CATEGORIES` from `prisma/seed.ts`: that module builds its
own `PrismaClient` at import time, which would open a second connection pool inside every
serverless function that touched it.

### 3.4 Smaller calls, for the record

- **`unitPrice` override is allowed on create**, as the prompt specified — necessary,
  since all 62 seeded products sit at `price 0`. When omitted, the catalog price is
  snapshotted. `lineTotal` and `totalAmount` are **never** accepted from the client.
- **Duplicate products are allowed on one sale** (two lines, same product). A POS should
  permit it; merging silently would be surprising.
- **`dateTo` is inclusive.** Implemented as `lt` the start of the *following* Karachi day,
  so a sale landing exactly on midnight isn't double-counted.
- **List ordering is `saleDate desc, createdAt desc`.** The tiebreak matters: without it,
  same-day sales can repeat or vanish across page boundaries.
- **Page + total come from one `$transaction`**, so the pager can't advertise a page that
  isn't there.
- **PATCH transaction timeout raised to 15s** (`maxWait` 5s). Line updates are one round
  trip each, up to 100 lines; Prisma's 5s interactive default could roll back a legitimate
  edit over a pooled Supabase connection.
- **DELETE is a genuine hard delete.** Unlike `Product`, nothing references a sale, so
  there is no soft-delete case. The items are deleted explicitly before the parent even
  though `onDelete: Cascade` would do it — same stance as `lib/catalog-guards.ts`: we never
  let the database decide what goes.
- **`repricedItemIds: []`** is returned on a header-only PATCH too, so the client can read
  the field unconditionally.

---

## 4. Endpoint contracts

### `GET /api/beverages/sales`

Query: `customerId?`, `dateFrom?`, `dateTo?` (`yyyy-MM-dd`, Karachi), `page?` (1),
`limit?` (10, max 100).

```jsonc
{ "data": {
    "sales": [ { "id": "...", "saleDate": "2026-08-02T19:00:00.000Z", "totalAmount": 1250,
                 "notes": null, "createdAt": "...",
                 "customer": { "id": "...", "name": "Al Madina Hotel", "type": "hotel" },
                 "itemCount": 3 } ],
    "pagination": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 } },
  "error": null }
```

### `POST /api/beverages/sales` → 201

```jsonc
{ "customerId": "...", "saleDate": "2026-08-03", "notes": "Morning drop",
  "items": [ { "productId": "prod_big_apple", "quantity": 12, "unitPrice": 80 } ] }
```

### `GET /api/beverages/sales/[id]`

Full sale + items. Each item: `id, productId, quantity, unitPrice, lineTotal, product{ id,
name, size, discountPercent, unit, isActive }`. **Money on a line is always the line's own
snapshot** — `product.price` is not selected anywhere in this file.

### `PATCH /api/beverages/sales/[id]`

`{ saleDate?, notes?, items? }`. Omit `items` → header-only, lines untouched. Send `items`
→ it is the complete desired set: entry **with** `id` = keep/edit that line, **without**
`id` = new line, any existing line **absent** = removed. Response is the full sale plus
`repricedItemIds`.

### `DELETE /api/beverages/sales/[id]`

`{ "data": { "deleted": "hard", "id": "...", "itemCount": 3 }, "error": null }`

### `GET|POST /api/customers`

`GET` → `[{ id, name, phone, type, isActive }]`, active-only unless
`?includeInactive=true`, `?search=` matches name. `POST { name, phone?, type }` → 201;
duplicate name (case-insensitive) → 409.

---

## 5. Test list

### 5.1 Getting an authenticated session for curl

Every route is owner-only. Sign in at `http://localhost:3000/login`, then copy the session
cookie from DevTools → Application → Cookies:

- local http → `authjs.session-token`
- deployed https → `__Secure-authjs.session-token`

```bash
npm run dev
COOKIE='authjs.session-token=PASTE_VALUE_HERE'
BASE='http://localhost:3000'
```

### 5.2 Auth gate — run this first

| # | Command | Expect |
|---|---|---|
| 1 | `curl -i $BASE/api/beverages/sales` (no cookie) | **401** + `{"data":null,"error":"You must be signed in."}` — JSON, **not** an HTML redirect |
| 2 | `curl -i -X POST $BASE/api/customers -d '{}'` (no cookie) | **401**, same JSON envelope |

That is the Gotcha 3 / middleware behaviour. If either returns HTML or a 307, stop —
something regressed in `lib/auth.config.ts`.

### 5.3 Happy path

```bash
# 3. Create a customer  -> 201
curl -s -X POST $BASE/api/customers -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Al Madina Hotel","phone":"0300-1234567","type":"hotel"}'

# 4. List customers -> the one you just made
curl -s $BASE/api/customers -H "Cookie: $COOKIE"

# 5. Create a sale -> 201.  Substitute CUSTOMER_ID from step 3.
#    Seeded products are all price 0, so this passes explicit unitPrice overrides.
curl -s -X POST $BASE/api/beverages/sales -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"customerId":"CUSTOMER_ID","saleDate":"2026-08-03","notes":"Morning drop",
       "items":[{"productId":"prod_big_apple","quantity":12,"unitPrice":80},
                {"productId":"prod_coke_cola_half_litre","quantity":6,"unitPrice":60}]}'
```

**Check on the response to #5:**
- `totalAmount` is **1320** — a JSON *number*, not `"1320"`, not `{"s":1,"e":3,"d":[...]}`. This is Gotcha 2.
- Each `lineTotal` is a number: `960` and `360`.
- `saleDate` comes back **`2026-08-02T19:00:00.000Z`** — that is correct and is the point of Gotcha 4. It is UTC storage for Karachi midnight on 3 Aug (UTC+5). Do not "fix" it.

```bash
SALE_ID=<id from step 5>

# 6. Read one sale
curl -s $BASE/api/beverages/sales/$SALE_ID -H "Cookie: $COOKIE"

# 7. List, paged
curl -s "$BASE/api/beverages/sales?page=1&limit=10" -H "Cookie: $COOKIE"
```

### 5.4 The Karachi date boundary (Gotcha 4)

Already verified in isolation — `startOfKarachiDay("2026-08-03")` = `2026-08-02T19:00:00Z`,
`endOfKarachiDay` = `2026-08-03T19:00:00Z`, and an instant of `2026-08-03T20:00:00Z` (1am
Karachi on the 4th) correctly buckets to **2026-08-04**, falling outside the 3 Aug window
and inside the 4 Aug one. Naive `toISOString().slice(0,10)` calls that same instant the 3rd
— the exact bug the rule exists to prevent.

To confirm end-to-end against real rows:

| # | Command | Expect |
|---|---|---|
| 8 | `curl -s "$BASE/api/beverages/sales?dateFrom=2026-08-03&dateTo=2026-08-03" -H "Cookie: $COOKIE"` | the sale from #5 |
| 9 | `curl -s "$BASE/api/beverages/sales?dateFrom=2026-08-04&dateTo=2026-08-04" -H "Cookie: $COOKIE"` | **empty**, `total: 0` |
| 10 | `curl -s "$BASE/api/beverages/sales?dateFrom=2026-08-05&dateTo=2026-08-01" -H "Cookie: $COOKIE"` | **400** "The start date must be on or before the end date." |

### 5.5 Price snapshot — the important one (Gotcha 5)

This is the test that proves history is safe. Run it in order.

```bash
# 11. Note the sale's current totalAmount (1320) and Big Apple's line unitPrice (80).

# 12. Now CHANGE the catalog price of that product to something obvious.
curl -s -X PATCH $BASE/api/products/prod_big_apple -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' -d '{"price":999}'

# 13. Re-read the sale.
curl -s $BASE/api/beverages/sales/$SALE_ID -H "Cookie: $COOKIE"
```

**Expect the sale to be COMPLETELY UNCHANGED** — `unitPrice` still `80`, `lineTotal` still
`960`, `totalAmount` still `1320`. If any of those moved to reflect 999, the snapshot rule
is broken and nothing else in this phase matters.

```bash
# 14. Header-only PATCH — must not touch a single line.
curl -s -X PATCH $BASE/api/beverages/sales/$SALE_ID -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' -d '{"notes":"Paid in cash"}'
```
Expect: notes updated, `unitPrice` still 80, `totalAmount` still 1320,
`repricedItemIds: []`.

```bash
# 15. QUANTITY-ONLY edit. Substitute the Big Apple ITEM id from the sale.
curl -s -X PATCH $BASE/api/beverages/sales/$SALE_ID -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"ITEM_ID_BIG_APPLE","productId":"prod_big_apple","quantity":15},
                {"id":"ITEM_ID_COKE","productId":"prod_coke_cola_half_litre","quantity":6}]}'
```
Expect: the Big Apple line **KEEPS `unitPrice` 80** despite the catalog now saying 999 —
`lineTotal` 1200, Coke unchanged at 60, `totalAmount` **1560**, and
**`repricedItemIds: []`**. If `unitPrice` came back 999, the fix in decision 3.1 regressed.

```bash
# 15b. PRODUCT SWAP on the same line -> this one MUST re-price.
curl -s -X PATCH $BASE/api/beverages/sales/$SALE_ID -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"ITEM_ID_BIG_APPLE","productId":"prod_big_lychee","quantity":15},
                {"id":"ITEM_ID_COKE","productId":"prod_coke_cola_half_litre","quantity":6}]}'
```
Expect: that line re-snapshots to Big Lychee's current catalog price, and
`repricedItemIds` contains **only** that item id. (Swap it back afterwards, or re-run
step 5 for a clean sale.)

```bash
# 16. Explicit override always wins.
curl -s -X PATCH $BASE/api/beverages/sales/$SALE_ID -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"ITEM_ID_BIG_APPLE","productId":"prod_big_apple","quantity":20,"unitPrice":80},
                {"id":"ITEM_ID_COKE","productId":"prod_coke_cola_half_litre","quantity":6}]}'
```
Expect: `unitPrice` 80, `lineTotal` 1600, `repricedItemIds: []`.

```bash
# 17. Add a line and remove one, in a single PATCH. Coke omitted => deleted.
curl -s -X PATCH $BASE/api/beverages/sales/$SALE_ID -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"ITEM_ID_BIG_APPLE","productId":"prod_big_apple","quantity":20,"unitPrice":80},
                {"productId":"prod_big_lychee","quantity":5,"unitPrice":45}]}'
```
Expect: 2 items, Coke gone, `totalAmount` = 1600 + 225 = **1825**.

```bash
# 18. Put the catalog price back.
curl -s -X PATCH $BASE/api/products/prod_big_apple -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' -d '{"price":0}'
```

### 5.6 Validation and error paths

| # | Body / request | Expect |
|---|---|---|
| 19 | `POST` sale with `"items":[]` | 400 "Add at least one item to the sale." |
| 20 | `"quantity":0` | 400 "Quantity must be at least 1" |
| 21 | `"quantity":1.5` | 400 "Quantity must be a whole number" |
| 22 | `"unitPrice":-5` | 400 "Price cannot be negative" |
| 23 | `"saleDate":"2026-13-45"` | 400 "That sale date isn't a valid date" |
| 24 | `"customerId":"nope"` | **404** "That customer no longer exists." — a sentence, **not** a raw FK error |
| 25 | `"productId":"nope"` | 404 "One of the products on this sale no longer exists…" |
| 26 | `"productId":"prod_biscuits_premium"` (a **Bakery** product) | **400** "…is not a Beverages product, so it can't go on a beverages sale." |
| 27 | `GET /api/beverages/sales/does-not-exist` | 404 "That sale no longer exists." |
| 28 | `PATCH` with `{}` | 400 "Nothing to update" |
| 29 | `PATCH items` with an `id` from a *different* sale | 409 "One of the lines you edited is no longer part of this sale…" |
| 30 | `?limit=500` | 400 "Limit cannot exceed 100" |
| 31 | `POST /api/customers` duplicate name | 409 `A customer named "…" already exists.` |
| 32 | `POST /api/customers` `"type":"restaurant"` | 400 "Choose a customer type: hotel, individual or shop" |

Schema-level cases 19–23 and 30 are already verified directly against the zod schemas; the
rest need the server.

### 5.7 Cleanup

```bash
# 33. Delete the sale.
curl -s -X DELETE $BASE/api/beverages/sales/$SALE_ID -H "Cookie: $COOKIE"
```
Expect `{"deleted":"hard","id":"…","itemCount":2}`. Then confirm the items are gone —
`SELECT count(*) FROM "BeverageSaleItem" WHERE "saleId" = '…'` → 0.

**Leave one sale in place if you intend to run the 409 re-test below.**

---

## 6. FLAG: the Phase 2 delete-guard 409 path is now exercisable

Per the Phase 2 carried-forward note, the guarded-delete 409 has **never fired outside a
test fixture** because it needs real sale history. Creating a sale here produces the
**first real `BeverageSaleItem` rows in the database**, which finally makes it testable.

**Do this after 3.2**, when the catalog UI can show the amber refusal:

1. Record a beverage sale containing, say, `prod_big_apple`.
2. Try to delete the **"Big Apple" sub-category** (or the whole **Beverages** category).
3. Expect **409** with the amber refusal and a structured
   `blockedBy: [{ id, name, saleCount }]` — consumed as a field, never parsed from the prose.
4. Confirm the "deactivate these instead" action PATCHes **by id** and succeeds.
5. Separately, try deleting **the product itself**: that path is *not* a 409 — it
   **soft-deletes** (`{ deleted: "soft" }`, `isActive` → false, 200) so past sale lines
   still resolve a name. Both branches are now reachable and both should be re-tested for
   real.

---

## 7. Verification performed

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, no errors |
| `npx next lint` on all 7 new files | ✔ No ESLint warnings or errors |
| Karachi date transform + all zod schemas, executed | verified (§5.4, cases 19–23, 30) |
| **`reconcileSaleLines()` executed against fixtures** | **8/8 passed** — see §7.1 |
| Supabase column check, read-only | matches `schema.prisma` |
| Prisma version | `@prisma/client` 6.19.3 — v6 conventions only |
| Migration run? | **No.** Tables already existed; no schema change was needed. |
| Production build | **PASSED** on Vercel preview — see §7.2 |

### 7.1 Price-snapshot checks, executed

Ran `reconcileSaleLines()` — the exact function the PATCH route calls — against a fixture
where the stored sale is *Big Apple x12 @ 80, Coke x6 @ 60* and the catalog has since moved
Big Apple to **999**:

| Case | Result |
|---|---|
| quantity only 12→15 | **PASS** — kept **80**, total 1560, `repriced: []` |
| product swap → Big Lychee | **PASS** — re-priced to 45, `repriced: ["item_apple"]` |
| product swap **and** quantity change | **PASS** — re-priced to 45 (product drives it) |
| new line added | **PASS** — snapshotted current price 45, existing lines untouched |
| explicit `unitPrice` on a product swap | **PASS** — held at 500, `repriced: []` |
| line removed, other untouched | **PASS** — kept 80, `removed: ["item_coke"]` |
| duplicate line id | **PASS** — 400 |
| line id from another sale | **PASS** — 409 |

**8/8 passed.** The headline: a quantity-only edit no longer re-prices at today's catalog
price, while a product swap and a new line still do.

### 7.2 Vercel preview deploy — real build signal

Commit `3cf2fc6`. Deployed with `vercel deploy` (**no `--prod`**; `target: null` confirms
preview, production is untouched).

| | |
|---|---|
| Result | **READY** — build completed in 42s |
| Preview URL | `https://muneeb-inventory-system-9x36tkriz.vercel.app` |
| Deployment | `dpl_GdiawGKS2LaWXMucRvwTQ2iE7d6C` |
| Prisma client | generated **v6.19.3** in both `postinstall` and the build command, as designed |
| New routes registered | `ƒ /api/beverages/sales`, `ƒ /api/beverages/sales/[id]`, `ƒ /api/customers` — all dynamic, 0 B client JS |

**Edge bundle is clean.** `ƒ Middleware 78.2 kB` — unchanged in order of magnitude from
Phase 2.1 and far too small to contain the Prisma client (~1 MB+) or bcryptjs. The split
config (Gotcha 3) still holds. Confirmed behaviourally against the live preview rather than
by grepping a local artifact, since this machine OOMs on a production build:

| Request (signed out) | Result |
|---|---|
| `GET /api/beverages/sales` | **401** `{"data":null,"error":"You must be signed in."}`, `Content-Type: application/json` |
| `GET /api/customers` | **401**, same JSON envelope |
| `GET /` (page) | **307** → `/login?callbackUrl=…` |
| `GET /login` | **200** HTML — the only public page |

That exercises both arms of the `authorized` callback in production: JSON for `/api/`,
redirect for pages. Middleware executing correctly on Edge is itself proof the bundle
carries no Node-only dependency.

> Note: preview deployments sit behind Vercel's SSO Deployment Protection, so a plain
> `curl` gets a 302 to `vercel.com/sso-api` before ever reaching the app. Use
> `vercel curl <url>` to authenticate through it — a plain curl's 302 is the protection
> layer, not the app's middleware.

**One build warning, deliberately not acted on:** Prisma warns that
`package.json#prisma` is deprecated and *"will be removed in Prisma 7"*, suggesting a
migration to `prisma.config.ts`. **Ignore it.** This project is pinned to v6 on purpose and
`prisma.config.ts` is an explicitly forbidden v7 pattern (see the Prisma guardrail in
`CLAUDE.md`). The warning is correct about v7 and irrelevant to us.

---

## 8. Still open

1. **Context7** — reconnect before 3.2? The UI work leans on shadcn and TanStack Query,
   where stale API knowledge bites harder than it does with Prisma.
2. **The 409 / soft-delete re-test** in §6, once 3.2 can show the amber refusal.

Decision 3.1 is resolved (quantity no longer re-prices) and `CLAUDE.md` is updated. All
other decisions in §3 stand as implemented.

No migration was run.
