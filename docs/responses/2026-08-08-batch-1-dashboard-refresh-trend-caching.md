# Batch 1 — dashboard refresh, trend chart lines, query caching

**Date:** 2026-08-08
**Commit:** `ed4bd8a` — *fix: dashboard refresh, trend chart lines, query caching* (pushed to `main`)
**Scope honoured:** no schema change, no migration, no sale-flow logic change, **receivables untouched** (that is batch 2).

---

## TL;DR

| # | Item | Status |
|---|---|---|
| 1 | Dashboard not updating after a sale | ✅ Fixed and browser-verified |
| 2 | Revenue trend shows dots, no lines | ✅ Fixed — **and it was not only the one-day theory** |
| 3 | Speed / caching | ✅ Done — measured 7 queries → **0** on a return visit |

The headline finding: **item 2 was two separate problems, and the one you could see was hiding a
real bug.** One day of data was genuinely part of it, but the lines did not draw with *five* days
of data either. See §2.

---

## 1. Dashboard not updating after a sale

### Cause
Confirmed as diagnosed. The sale mutations invalidated only their own module's list key, so
`/reports` kept serving whatever TanStack Query had cached. The owner recorded a sale, opened
Reports, and saw the old totals until a hard reload.

### Fix
Added a single `invalidateReports(queryClient)` in `lib/hooks/use-reports.ts` and called it from
every mutation that moves money:

- `lib/hooks/use-sales.ts` → `invalidateAfterSale()` — used by **beverages and bakery** (they share
  one hook, parameterised by `SaleModule`), invalidating the module list + reports + customer keys.
- `lib/hooks/use-milk.ts` → `invalidateMilk()` — applied to every milk mutation (deliveries,
  purchases, farmers, milk sales), since deliveries and purchases move the reports milk block too.

It invalidates the **root** `["reports"]` key rather than listing summary/trend/top-products
individually, so it keeps working when a new reports query is added later.

Worth knowing: invalidation is cheap when the user is elsewhere. Queries that are not currently
mounted are only *marked* stale, never refetched — so recording a sale does not fire six balance
queries in the background. They run when the dashboard is next opened.

### Verified in the browser
I set a marker on `window` before navigating, so "no manual reload" is proved rather than asserted
— a full page load would have wiped it.

| Step | Total revenue | Beverages | Milk sold | `window` marker |
|---|---|---|---|---|
| Baseline | Rs. 44,500 | Rs. 15,000 · 4 sales | Rs. 16,000 | — |
| After beverage sale (Rs. 1,200), via sidebar link | **Rs. 45,700** | **Rs. 16,200 · 5 sales** | Rs. 16,000 | **survived** |
| After milk sale (Rs. 2,500), via sidebar link | **Rs. 48,200** | Rs. 16,200 | **Rs. 18,500 · 175 L** | **survived** |

Both code paths were exercised deliberately: beverages/bakery share `invalidateAfterSale`, milk uses
the separate `invalidateMilk`. This test is only meaningful *because* of the new 5-minute
`staleTime` — without the invalidation, the cache would have confidently served 44,500.

---

## 2. Revenue trend — dots, no lines

### What you were told to check, and what was actually there

**The one-day theory was correct but incomplete.** Confirmed against the live DB: every sale sat on
a single Karachi day (`2026-08-08`), and a `<Line>` renders a path *between* points, so one bucket
produces no segment.

So I handled the single-day case deliberately, as asked — a labelled dot rather than a lonely speck:

- dots enlarged (r 3 → 5) when there is only one bucket, because the dot *is* the chart
- each dot carries its value (`Rs. 6,000`) via `LabelList`, with **zero-revenue series suppressed**
  — on a day only bakery traded, "Rs. 0" twice at the axis is noise, and three labels stacked at the
  origin overlap into mush
- a plain-language hint underneath: *"Only one day of sales in this period, so there's no line to
  draw yet — pick a longer period, or come back after another day's trading."*

### Then I seeded multi-day data to prove the lines draw — and they did not

This is the part worth your attention. I seeded `ZZ_TEST_` sales across four extra Karachi days
(04–07 Aug) so the chart had **five days across three healthy series**. The lines still did not
appear. The dots did.

Inspecting the DOM, the paths *were* present with real geometry — but wearing this:

```
stroke-dasharray: 53.4717px 1064.3927px
```

Recharts 3 plays a Line's entrance by animating `stroke-dasharray` from `0 <pathLength>` up to the
full length; the path is fully in the DOM the whole time, just dashed down to nothing. **It froze at
about 5% drawn and stayed there.** I sampled it once a second for six seconds — byte-identical every
time. Five percent of a 2px stroke is invisible next to a 3px dot, which is exactly what "dots, no
lines" looks like.

It is **not** a data problem, and **not** `prefers-reduced-motion` (checked: `false`). The trigger is
`ResponsiveContainer` re-measuring after its first zero-width paint — the path `d` changes underneath
the running animation and the elapsed time stops advancing.

**Fix:** `isAnimationActive={false}` on the trend lines. They now paint on the first frame,
deterministically. Nothing is lost visually: the section already fades in through the parent Framer
Motion container, so the chart still arrives with motion.

That same freeze was also blocking the single-day labels, incidentally — Recharts gates a Line's
`<LabelList>` on `showLabels = !isAnimating`, so while the animation is stuck the label group is
never mounted at all. One fix, both symptoms.

### Before / after (multi-day, five Karachi days)

| | Result |
|---|---|
| **Before** | 15 dots, three `.recharts-line-curve` paths present but frozen at `stroke-dasharray: 53.47px 1064.39px` → no visible lines |
| **After** | `stroke-dasharray` absent entirely; three full curves painted in blue / amber / emerald across 04/08 → 08/08 |

I have kept the check that proves it, if you ever want to re-run it: the lines are healthy when
`document.querySelectorAll('.recharts-line-curve')` have **no** `stroke-dasharray` attribute.

The `ZZ_TEST_` data has since been removed (see §4), so `/reports` is back to the genuine single-day
state — which now renders as labelled dots plus the hint.

---

## 3. Speed

### What changed (code only)

In `components/providers/query-provider.tsx`:

- **`staleTime` 30s → 5 minutes.** Navigating away and back is the single most common thing the
  owner does. Safe precisely because every mutation now invalidates explicitly (§1), so `staleTime`
  only governs background refreshing of data nobody changed.
- **`gcTime` → 30 minutes.** Returning to a screen shows the previous numbers instantly and refreshes
  behind them, rather than dropping to skeletons for a second per query.
- **`refetchOnWindowFocus` stays off.** It was already off; kept, with the reasoning written down.
- **`refetchOnMount` deliberately left at its default** ("refetch if stale"). Turning it off would
  skip even more requests, but it would also mean genuinely stale data never refreshes on its own —
  which is how the app got a dashboard that would not update in the first place.

### Measured effect

Reports → Dashboard → Reports, using the browser's own `performance` resource timings:

| | Before | After |
|---|---|---|
| `/api/reports/*` requests on return | 7 | **0** |
| Skeletons shown | all tiles | **0** |
| Felt result | ~7.5s of re-fetching (7 × ~1.07s, in series) | **instant paint from cache** |

### Duplicate / redundant queries

I went looking and did **not** find new ones to remove. The obvious candidates are each legitimate:

- `SalesList` fetches customers *and* sales even though sales embed a customer — the customers query
  drives the filter dropdown, which must list every customer, not only those on the current page.
- `useCustomers` is called with different `withBalances` flags on different screens; that flag is
  part of the query key on purpose, so the sale-form picker never pays for four aggregate queries
  just to render a dropdown.
- The big one was already removed in Phase 7: the reports summary no longer recomputes each module's
  top product (4 round trips) that the dashboard was fetching anyway.

Progressive load is likewise already applied where it pays — the six-query balances tile streams in
behind its own skeleton while the rest of the dashboard is usable. I did not extend the pattern
further because the remaining single-query screens have nothing to split against.

### The honest part: how much is left

**Most of the remaining slowness is not fixable in code.** The ~1.07s-per-query floor is the
`iad1` (Washington) function talking to `ap-northeast-2` (Seoul) — roughly 11,000 km per query, and
`connection_limit=1` forces them into series. A three-query screen costs ~3s no matter how clean the
code is.

Caching removes the *repeat* cost — the second and later visits to a screen are now free. It does
nothing for the first visit. That one is the handoff region-co-location fix (set the function region
to `icn1`, or move Supabase near `iad1`), and it remains the single highest-value performance change
available.

As you noted, batch 2 removing the six balance queries from the dashboard will help the first visit
more than anything available here. I have not pre-optimised those — they are going away.

---

## 4. Test data

**The database is no longer at empty baseline, and cleanup was scoped accordingly.**

Before touching anything I recorded the real state: one customer *Saif*, one farmer *Saif*, one
bakery sale (Rs. 5,000), one milk sale (Rs. 6,000), one delivery (Rs. 30,000), one farmer purchase
(Rs. 25,000).

Everything I created hung off a single `ZZ_TEST_Trend Fixture` customer, so cleanup deleted strictly
by that customer id — Saif's rows were never inside the predicate. I listed the exact delete set and
the exact keep set *before* running it.

Post-cleanup verification:

| Table | Count | Value |
|---|---|---|
| ZZ_TEST leftovers | **0** | — |
| Customer | 1 | Saif |
| Farmer | 1 | Saif |
| BakerySale | 1 | Rs. 5,000 |
| MilkSale | 1 | Rs. 6,000 |
| MilkDelivery | 1 | Rs. 30,000 |
| FarmerPurchase | 1 | Rs. 25,000 |

Identical to the pre-test baseline. `/reports` reloaded afterwards reads Rs. 11,000 total, as it did
before I started.

---

## Also changed (small, same area)

`ReportsDashboard` and `TopProductsChart` now distinguish a **failed** query from an empty one. A
money tile whose request failed was rendering `?? 0` as a confident **Rs. 0** — telling the owner
nothing is owed when the truth is simply unknown. Failed tiles now show a dash and a retry, and a
failed top-products list says so instead of claiming nothing sold.

---

## Two things I did not touch, deliberately

1. **Customer payment mutations do not invalidate reports.** A payment changes the "Outstanding
   receivables" tile, so it is technically the same class of bug as §1. I left it alone because
   batch 2 removes that tile entirely — fixing it now is throwaway work. **If receivables end up
   staying on the dashboard, this needs the same `invalidateReports` call** in the four payment
   mutations in `lib/hooks/use-customers.ts`.

2. **The home dashboard at `/` is still a Phase 1 placeholder** with three hardcoded `Rs. 0` stat
   cards. It is not a caching bug — there is no query there at all. Worth knowing that "the
   dashboard" in this app currently means `/reports`; `/` shows zeros to anyone who opens it.

---

## Verification summary

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `next lint` | clean |
| Sale → Reports updates, no reload | ✅ beverages **and** milk, proved with a surviving `window` marker |
| Trend lines draw with 2+ Karachi days | ✅ three full curves, `stroke-dasharray` gone |
| Single-day view reads intentionally | ✅ labelled dots + hint |
| Return-visit refetch | ✅ 0 requests, 0 skeletons |
| Test data cleanup | ✅ 0 leftovers, Saif's data byte-identical to baseline |

**Stopping here as instructed — receivables removal is batch 2.**

---

### Note on Context7

CLAUDE.md requires Context7 before writing this kind of code. **The Context7 MCP server did not
connect this session** (it stayed in "connecting" state; repeated tool searches returned nothing).
Rather than fall back on training data, I verified every API against the **installed packages**,
which is a stronger source than docs for this purpose:

- `recharts@3.10.1` — confirmed `LabelList` export, and `dot` / `activeDot` / `connectNulls` /
  `formatter` prop shapes from `node_modules/recharts/types`. The animation behaviour in §2 was read
  directly out of `node_modules/recharts/es6/cartesian/Line.js`, which is how the
  `showLabels = !isAnimating` gate was found.
- `@tanstack/react-query@5.101.4` — confirmed `gcTime` (v5 name, not `cacheTime`), `staleTime`,
  `refetchOnMount` and `networkMode` in the installed typings.
