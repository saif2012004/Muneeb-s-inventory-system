# Chunk 2 implementation — approved subset shipped

**Date:** 2026-08-11
**Start:** HEAD `beb8de7`, 0 tracked modifications · **End:** HEAD `95122e1`, pushed
**Scope honoured:** F1, A1+B1, C1, D1, E3, G1. **E1/E2, D2–D5, F2 not touched.**
`components/ui/dialog.tsx` was never opened.

---

## THE REMOUNT VERDICT — clean, no functional regression

`template.tsx` remounts children on every navigation, so this was the gate before committing.
Instrumented `fetch` and toast insertion, then walked
Dashboard → Beverages → Milk → Customers → back → revisit.

| Check | Result |
|---|---|
| **Revisiting a screen refetches?** | **NO — zero network calls.** `apiCalls_REVISIT_beverages: 0`, and 0 again on a second revisit and on returning to the dashboard |
| Total API calls across the whole trail | **5**, each endpoint exactly once: `/api/reports/summary`, `/api/milk/farmers`, `/api/customers`, `/api/beverages/sales`, `/api/products` |
| **Doubled toasts?** | **NO — 0 observed** |
| **Lost form state mid-entry?** | **NO** — typed quantity `7` on the new-sale screen persisted |
| Empty→filled flicker beyond the transition | none observed |

**Why it holds:** TanStack Query's cache lives in `QueryProvider`, which is in `layout.tsx` —
*above* the template. The template and the page below it remount; the cache, sidebar, bottom nav and
providers do not.

---

## The five commits

| # | Hash | |
|---|---|---|
| 1 | **`c32fe68`** | `docs: note dual StatCard components in Design System` |
| 2 | **`a0a3985`** | `feat: app-wide route transition; remove now-redundant section entrances` |
| 3 | **`d307a96`** | `feat: animate tab content transitions (FarmerProfile)` |
| 4 | **`ccc083f`** | `feat: animate sale row removal in SalesList` |
| 5 | **`95122e1`** | `fix: speed up sheet open (500ms felt slow)` |

---

## Three judgement calls I made — please sanity-check

### 1. `NewSaleForm`'s entrance was KEPT, not removed

B1 listed six screens. I removed **five**. The sixth, `NewSaleForm.tsx:298`, sits inside
`if (justSaved)` — it is the **"Sale recorded" confirmation card**, which appears on a *state*
change, not a navigation. The route transition never fires for it, so removing it would have left
the card popping in with nothing replacing the animation. It was never the route transition's to
own.

### 2. `ReportsDashboard` got NO tab animation — it has no tab content

C1 named two screens. **`ReportsDashboard` has no `<TabsContent>` at all.** Its `Tabs` is a *period
selector* (Today / This Week / This Month / This Year) driving `period` state; the content below is
the same layout refetched, not a panel. There was nothing to wrap.

The analogous change would be keying the stat block on `period` so it re-enters on switch — **but
that restarts the `AnimatedMoney` count-ups on every period change, which is money-display
behaviour.** Raising it for approval rather than doing it.

### 3. The first server-rendered paint deliberately does not animate

This one was a **requirement miss I caught and fixed before committing**, not a design preference.

My first template used `enterUp(reduceMotion, TWEEN.page)` directly. Tested with reduced motion on:
**a full page load still travelled 8px.** Cause: `useReducedMotion()` cannot work on the server —
no `matchMedia` — so it is falsy there and SSR paints `opacity: 0; transform: translateY(8px)` into
the HTML; the client then animates from whatever the server painted. The `globals.css`
`prefers-reduced-motion` block does not catch it, because framer-motion drives inline transforms
with rAF rather than CSS transitions.

Fixed with a **module-level** `hasHydrated` flag — not component state, which would reset on every
template remount and never distinguish "first load" from "third navigation". It also removes a
hydration mismatch, and is right on its own terms: a hard reload is not a route transition.

---

## The SalesList diff (D1) — required in full

**Purely additive: 10 lines added, 0 removed.** Motion props only — no handler, no delete logic, no
calculation, no state.

```diff
--- a/components/sales/SalesList.tsx
+++ b/components/sales/SalesList.tsx
@@ -362,13 +362,22 @@ export function SalesList({ module }: { module: SaleModule }) {
             salesQuery.isFetching && "opacity-60 transition-opacity"
           )}
         >
+          {/* Row-level AnimatePresence: a DELETED sale animates out instead of
+              blinking away. Separate from the per-row AnimatePresence further
+              down, which owns the expand/collapse of that row's line items. */}
+          <AnimatePresence initial={false}>
           {sales.map((sale) => {
             const isExpanded = expandedId === sale.id;
 
             return (
               <motion.article
                 key={sale.id}
                 layout={reduceMotion ? false : "position"}
+                exit={
+                  reduceMotion
+                    ? { opacity: 0 }
+                    : { opacity: 0, height: 0, marginTop: 0 }
+                }
                 transition={SPRING.saleRow}
                 className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
               >
@@ -436,7 +445,8 @@ export function SalesList({ module }: { module: SaleModule }) {
                 </AnimatePresence>
               </motion.article>
             );
           })}
+          </AnimatePresence>
         </div>
       )}
```

The pre-existing per-row `AnimatePresence` (line-item expand/collapse) is untouched — this is a
second, separate one at the list level.

---

## Verification

| Check | Result |
|---|---|
| **Route transition plays** | Client nav sampled: `translateY(8px) → 6.41 → 5.94 → … → none` (~200ms) |
| **Reduced motion suppresses it** | Client nav with reduced motion: **0 of 182 frames travelled** |
| Full load, normal motion | **no travel** (by design — see judgement call 3) |
| Full load, reduced motion | **no travel** |
| **Tabs fade (FarmerProfile)** | Switching to Ledger: `translateY(8px) → 7.80 → 7.54 → 6.84 → 5.82 → … → none`, opacity `0 → 1`, 14 frames |
| **Sale row deletion animates** | With 2 rows, deleting one: **21 frames** of `height 79.65 → 73.14 → 62.57 → 51.66 → 40.65px`, `margin-top: 0`; list went 2 → 1 |
| **Sheet opens quickly** | `duration-500` → `duration-200`; close left at 300ms, as scoped |
| All 10 routes | **200**, no error markup: `/`, `/beverages`, `/bakery`, `/milk`, `/milk/quick-entry`, `/milk/balances`, `/customers`, `/catalog`, `/reports`, `/settings` |
| Console | **zero errors, zero warnings** |
| 360px | **no horizontal overflow**, bottom nav present, template wrapper present |
| `tsc --noEmit` (4096 heap) | **exit 0** |
| `next lint` | **clean** |
| `npm run build` | **green** |

### Known limitation, found while testing and reported rather than hidden

**Deleting the LAST sale does not animate.** `sales.length === 0` swaps the whole list container for
the empty state, so the `AnimatePresence` unmounts along with its child and has nothing to play out.
My first delete test hit exactly this and showed zero exit frames — which is how it was found.
Inherent to the empty-state branch, not introduced by this change; fixing it means restructuring
that branch.

---

## Data integrity

| | |
|---|---|
| `Product` | **27**, fingerprint `95794a0bb44f1b15d541a60ef0bd5c51` — **matches baseline** |
| `Customer` | **1** — `Saif` |
| `BakerySale` | Rs. **5,000** · `MilkSale` Rs. **6,000** · `BeverageSale` 0 |
| `User` | 1 — `i228767@nu.edu.pk` |

All `ZZ_TEST_` rows removed (user, customer, four probe sales and their items); product stock
restored to 100. **The 2 real sales and Saif were never modified.**

---

## Constraint compliance

| Constraint | Status |
|---|---|
| No money-logic, no `Sale`/`SaleItem`, no Migration B, no receivables, no data | ✅ |
| 2 real sales + Saif untouched | ✅ fingerprint verified |
| No dependency installs/removals; stayed on framer-motion | ✅ |
| E1/E2 dropped — `dialog.tsx` not edited | ✅ `git status` clean for that file throughout |
| D2–D5 deferred; F2 not attempted | ✅ |
| `components/ui/tabs.tsx` untouched (#10 territory) | ✅ |
| Documented asymmetries not "balanced" | ✅ `lineItemInOut`'s no-scale entry and the AnimatedMoney/StatCard reduced-motion mechanism untouched |
| Separate commit per group | ✅ five commits |

---

## Open for your call

1. **ReportsDashboard period-switch animation** — keying the stat block on `period`. Touches
   AnimatedMoney count-up behaviour, so it wants the money gate.
2. **Deleting the last row** — animating it needs the empty-state branch restructured.
3. **D2–D5** (catalog, farmer ledger, milk sales, customers/balance-sheet lists) still deferred.

**Stopped here as instructed.**
