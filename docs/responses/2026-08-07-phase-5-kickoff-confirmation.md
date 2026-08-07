# Phase 5 kickoff — confirmation before any code

Date: 2026-08-07
Session: `muneeb inventory dev4`
Source prompt: `docs/prompt.txt`

CLAUDE.md read in full — gotchas, Prisma v6 conventions, the `connection_limit=1`
guardrail, the Design System, deployment posture and the carried-forward notes.
Nothing written yet. Below is the confirmation of the six points, each checked
against the repo and the live database rather than recalled from the doc.

---

## 1. We're on Phase 5 (milk shop); 1–4b are done

Confirmed, and verified in the tree rather than taken on trust:

| Claim | Evidence |
|---|---|
| Catalog seeded | Live DB: `Category` 2 rows, `SubCategory` 11, `Product` 62 |
| Shared sale components | `components/sales/`, parameterised by `SaleModule` in `lib/sale-modules.ts` (`BEVERAGES_MODULE`, `BAKERY_MODULE`) |
| Price snapshot lives once | `reconcileSaleLines()` in `lib/sales.ts` |
| Customers hub + receivables | `app/(dashboard)/customers/`, `app/api/customers/*`, calc in `lib/receivables.ts` |
| Milk already counted | `lib/receivables.ts` sums `prisma.milkSale` in **all three** paths — `getCustomerBalance` (L108), `getCustomerBalances` (L185), `getCustomerActivity`/`summariseActivity` (L285, L327), and `buildLedger` already emits a `module: "milk"` entry labelled `Milk sale · N L` (L382–391) |

So when Phase 5 part 4 writes `MilkSale` rows, customer balances, the ledger and
the running-balance column pick them up with **zero changes to `lib/receivables.ts`**.
That file stays read-only for this phase unless something genuinely new appears.

`/milk` is already in `NAV_ITEMS` and `PRIMARY_NAV` (`lib/nav.ts:65`) with the
emerald accent — the nav entry exists and currently points at a 404. Building the
route fixes that; no nav change needed.

### One thing the "mirror the sale modules" instinct would get wrong

`MODULE_CATEGORIES` in `lib/modules.ts` has exactly two keys, `beverages` and
`bakery`, and `ModuleKey` is derived from it. **Milk has no catalog Category and
no `Product` rows** — a `MilkSale` is a single row of `liters × ratePerLiter`
with no line-items table and no product FK. Concretely that means:

- `reconcileSaleLines()` does **not** apply to milk. There is no `unitPrice`
  snapshot because there is no catalog price to snapshot from; the rate is
  entered per sale and is already its own historical record.
- The shared `components/sales/` form is built around a product picker and a
  line-item array. A milk sale has neither. Adding a third `SaleModule` row would
  be forcing the wrong shape.
- `lib/sale-catalog.ts` (unit suffixes, picker labels) has no milk counterpart to
  drive.

This matches the prompt's warning that the milk module is mostly new logic. What
*does* transfer: the `{ data, error }` envelope, `requireOwner()`, `serialize()`,
the Karachi helpers, the TanStack Query hook shape, and the Design System.

## 2. Prisma pinned to v6 — v6 conventions only

Confirmed against the installed tree, not the lockfile alone:

```
@prisma/client@6.19.3
prisma@6.19.3
```

I will use `provider = "prisma-client-js"` with no `output`, import
`{ PrismaClient } from "@prisma/client"`, keep `url` + `directUrl`, add no driver
adapter and no `prisma.config.ts`. When Context7 returns Prisma docs I will read
them for v6 semantics and discard v7-only patterns (generator rename, generated
output path, adapters replacing `directUrl`, ESM-first output).

## 3. All DB access via Prisma; no Supabase JS client, no anon key, no RLS policies

Confirmed. Live check just now: **all 15 `public` tables report
`rls_enabled: true`**, including the four milk-side tables. That is the
documented default-deny steady state and I am not touching it.

Phase 5 adds **no new tables** — `Farmer`, `MilkDelivery`, `FarmerPurchase` and
`MilkSale` already exist and are migrated (all 0 rows). So the "every migration
that adds a table must also `ENABLE ROW LEVEL SECURITY`" rule has nothing to bite
on here, and **no migration should be needed for Phase 5 at all**. If one turns
out to be needed I will stop and ask first — migrations are never automatic.

Supabase MCP is used read-only, for schema confirmation like the check above.

## 4. Auth.js v5 — `auth()` / `requireOwner()`, 401 JSON under `/api/`

Confirmed in code:

- `lib/api.ts:56` — `requireOwner()` returns `fail("You must be signed in.", 401)`
  when there is no session, `null` to continue. Every milk route gets this as its
  first statement.
- `lib/auth.config.ts:70` — the `authorized` callback returns a 401 JSON response
  for `/api/` paths; page requests get `false` → redirect to `/login`.
- `lib/api-client.ts:79` — the client maps 401 to `SESSION_EXPIRED_MESSAGE`.
- `trustHost: true` is set (`lib/auth.config.ts:26`).

No `getServerSession` anywhere. `export const runtime = "nodejs"` on every route
that touches Prisma.

## 5. Decimals serialised to numbers at the boundary; `_sum` `?? 0`; never `Promise.all`

Confirmed, with the milk-specific wrinkles noted:

- `lib/serialize.ts` already ships **`serializeLiters()`**, written specifically
  for `MilkDelivery.morningLiters` — it **preserves `null`** so "no morning
  delivery recorded" stays distinguishable from "recorded as 0 litres". That
  distinction is load-bearing for the quick-entry screen and I will keep it.
  `serializeMoney()` collapses null to 0; `serialize()` walks nested results.
- Aggregates: `_sum` returns `null` on no rows — normalise with the existing
  `?? 0` / `sumOrZero` idiom. The farmer net balance
  (`SUM(MilkDelivery.totalAmount) − SUM(FarmerPurchase.amount)`) is exactly the
  shape that would silently read as `NaN` without it.
- **No `Promise.all` fan-out.** Awaited in series, and where a screen needs many
  rows I will fetch once and derive, as `getCustomerActivity()` does. The farmers
  balance sheet (Phase 6) is the obvious N+1 trap — it must be a fixed small
  number of `groupBy` queries over all farmers, not one query per farmer.
- All balance math stays server-side on `Prisma.Decimal`; the browser only ever
  sees numbers.

Timezone note that lands squarely on this phase: every timestamp column is
`timestamp without time zone` (UTC in the DB), and **`MilkDelivery.deliveryDate`
has no default** — it must be supplied explicitly. Morning/evening deliveries
near midnight PKT are precisely Gotcha 4's failure case, so day-bucketing goes
through the existing helpers in `lib/format.ts`: `startOfKarachiDay` /
`endOfKarachiDay`, `karachiDayKey`, `karachiRange` (half-open `gte`/`lt`), and
`karachiToday()` to seed pickers. Never `new Date()` server-side for a day, never
`toISOString()` for a bucket key.

## 6. Verification: Vercel preview for builds, real browser for UI

Confirmed and accepted. Local production builds can OOM on this machine, so
"does it build" is answered by a Vercel preview deploy, not `npm run build`
locally. `tsc --noEmit` and `next lint` are type/lint checks and prove nothing
about runtime — Phase 3.2 was green on both while carrying three real bugs, and
Phase 4b's pool timeout also type-checked perfectly.

Every Phase 5 screen gets exercised in a real browser before I call it done.

---

## Working rules I'm operating under

- Context7 for current Prisma 6 / shadcn / TanStack Query docs before writing code.
- Supabase MCP read-only to confirm real columns before writing a query.
- Design System: milk = **emerald**, one accent per screen, 44px touch targets,
  `tabular-nums`, `inputMode="decimal"` on litres and rates, loading/empty/error
  states on every list, confirm dialog on every destructive action, toast on every
  mutation, `prefers-reduced-motion` respected.
- Reuse over forking; keep the diff minimal.
- Deploys to Hobby are free and may be run. **Migrations are never automatic** —
  I'll confirm before any, and Phase 5 should need none.

### Carried-forward item I will NOT patch here

The Phase 8 touch-target queue: shadcn `TabsTrigger` is 28px and inline back
links are 20px, both under the 44px minimum. If Phase 5 uses tabs (deliveries /
purchases / sales on a farmer page) it inherits the same defect. Per CLAUDE.md
this is fixed **once, app-wide, in `components/ui/tabs.tsx` during the Phase 8
a11y sweep** — not patched piecemeal here.

### Open questions I'll resolve as I reach them (not blocking)

1. **Rate defaulting.** Does a delivery's `ratePerLiter` default to the farmer's
   last used rate, or is it typed every time? Last-rate-prefilled with an
   editable field is my default assumption — it is the common case for a daily
   entry and still fully overridable.
2. **Quick-entry shape.** "Quick entry" reads as a one-screen, all-farmers,
   today's-date grid: farmer rows × morning/evening litre fields, one save. I'll
   design it that way unless told otherwise, since that is the twice-daily
   workflow the module exists for.
3. **Delivery uniqueness.** There is no unique constraint on
   `(farmerId, deliveryDate)` in the schema — only an index. So two rows for the
   same farmer on the same day are possible. I plan to make the app treat a day
   as one row (upsert-by-day in a transaction) rather than add a constraint,
   since a constraint means a migration. Flagging it because it is a real
   decision, not an oversight.

Awaiting your go-ahead to start Phase 5 part 1.
