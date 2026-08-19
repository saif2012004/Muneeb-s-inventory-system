# Chunk 2 — RECON + PLAN ONLY

**Date:** 2026-08-11
**Code changes made: ZERO.** Read-only greps and file reads. No edits, installs, migrations, or data
access of any kind this turn.

---

## STEP 0 — Ground truth

```
$ git log --oneline -1
beb8de7 fix: StatCard reduced-motion money display (avoid dropped .set on mount)

$ git status --porcelain
?? docs/responses/2026-08-11-chunk-1-motion-vocabulary.md
?? docs/responses/2026-08-11-statcard-reduced-motion-fix.md
```

**HEAD = `beb8de7`** ✅ · **tracked modifications: 0** · **deletions: 0**. The two untracked files are
last turn's response docs. Nothing to stop for.

### The spec's stated motion intents, quoted back

From CLAUDE.md → Design System → **Motion (Framer Motion)**:

> - Purposeful, quick, spring-based. Nothing should feel slow.
> - **Page/tab transitions: subtle fade + 8px slide, ~200ms.**
> - Stat numbers: count-up on mount (respect the value type, format after animating).
> - **Dialogs/sheets: spring scale/slide via AnimatePresence.**
> - **List rows: `layout` animation when items are added/removed.**
> - **Always respect `prefers-reduced-motion`** and disable non-essential animation when set.

And from the vocabulary I added in Chunk 1, the relevant entries:

> | `SPRING.section` | 420 / 34 | **The canonical one.** A page section or card arriving. Reach for this first |
> | `TWEEN.page` | 0.2s easeOut | The Design System's ~200ms page transition |

**Everything below is judged against those five bullets, not against taste.**

---

## STEP 1 — Where the actual animation diverges from the spec

### 1A. Page transitions — **the spec's intent does not exist at all**

> *"Page/tab transitions: subtle fade + 8px slide, ~200ms."*

**There is no route transition anywhere.**

- `find app -name "template.tsx"` → **no matches.** `template.tsx` is Next's route-transition hook;
  without it a route change swaps the tree instantly.
- `app/(dashboard)/layout.tsx` renders children bare:
  ```tsx
  <main className="mx-auto w-full max-w-[640px] px-4 pb-24 pt-6 …">
    {children}
  </main>
  ```
  No motion wrapper, and a `layout.tsx` would not re-run on navigation anyway.

**Divergence: total.** Navigating Dashboard → Beverages → Milk is a hard cut.

**Visual change to close it: YES** — every navigation in the app would gain a ~200ms fade+slide.
This is the single most visible item in the whole chunk.

### 1B. Section entrances — present on 6 screens, absent on 7

What exists today is *not* a page transition but a per-screen section entrance (`enterUp`), applied
inconsistently:

| Screen | Entrance? |
|---|---|
| `components/sales/NewSaleForm.tsx` | ✅ `enterUp` ×2 |
| `components/milk/MilkHub.tsx` | ✅ ×2 |
| `components/milk/FarmerProfile.tsx` | ✅ ×2 |
| `components/milk/FarmerBalanceSheet.tsx` | ✅ ×2 |
| `components/milk/MilkSalesList.tsx` | ✅ ×2 |
| `components/reports/ReportsDashboard.tsx` | ✅ ×2 |
| **`components/dashboard/DashboardHome.tsx`** | ❌ **no motion import at all** |
| **`components/sales/SalesList.tsx`** | ❌ imports motion, but only for rows/collapse |
| **`components/customers/CustomersHub.tsx`** | ❌ none |
| **`components/customers/CustomerProfile.tsx`** | ❌ none |
| **`components/catalog/CatalogManager.tsx`** | ❌ none |
| **`components/settings/SettingsForm.tsx`** | ❌ none |
| **`components/milk/QuickEntryGrid.tsx`** | ❌ none |

**The dashboard — the app's home screen — has no entrance animation.** The milk module has it on
four screens; beverages/bakery lists have none.

**Visual change to close it: YES**, on the 7 screens that would gain one.

> ⚠️ **Worth deciding rather than assuming:** if 1A ships (a real route transition), 1B may become
> redundant or even doubled — a page fading in *and* its section sliding up reads as two animations
> for one navigation. **These two items interact and should be decided together.** My recommendation
> is in the plan.

### 1C. Tab transitions — absent

> *"Page/**tab** transitions: subtle fade + 8px slide, ~200ms."*

Only two screens use tabs — `components/milk/FarmerProfile.tsx` and
`components/reports/ReportsDashboard.tsx` — and **no `<TabsContent>` anywhere is wrapped in
`motion` or `AnimatePresence`**. Switching a tab is an instant swap.

**Visual change: YES**, on those two screens.

*#10 overlap, noted not acted on:* this would be done by wrapping `TabsContent` **in the two
consuming screens**, not by editing `components/ui/tabs.tsx` — which keeps it clear of the
touch-target work queued for that primitive.

### 1D. List add/remove — 3 of ~9 lists comply

> *"List rows: `layout` animation when items are added/removed."*

**Full compliance (2):**

| File | Evidence |
|---|---|
| `components/catalog/ProductTable.tsx` | `AnimatePresence initial={false}` (:74), `layout={reduceMotion ? false : "position"}` (:78), `rowInOut` |
| `components/sales/NewSaleForm.tsx` | `AnimatePresence` (:397), `layout` (:401), `lineItemInOut` — sale lines |

**Partial (1):**

| File | Evidence |
|---|---|
| `components/sales/SalesList.tsx` | `layout="position"` on the sale article (:371) so rows *reflow*, but its `AnimatePresence` (:425–436) wraps only the **expand/collapse** of line items. **A deleted sale still vanishes instantly** — the exact case the spec bullet names |

**No animation (6)** — all render `.map()`ed rows that can be added or removed:

```
components/customers/CustomersHub.tsx        .map():2   AnimatePresence:0
components/milk/MilkSalesList.tsx            .map():2   delete-refs:17   AnimatePresence:0
components/milk/FarmerBalanceSheet.tsx       .map():3   AnimatePresence:0
components/milk/FarmerProfile.tsx            .map():4   delete-refs:27   AnimatePresence:0
components/catalog/CatalogManager.tsx        .map():5   delete-refs:48   AnimatePresence:0
components/milk/QuickEntryGrid.tsx           .map():3   AnimatePresence:0
```

`CatalogManager` (48 delete references) and `FarmerProfile` (27) are the ones where rows most
visibly appear and disappear.

**Visual change: YES** for each list that gains it.

### 1E. Dialogs and sheets — CSS, not spring. **Primitive change; reported, not touched.**

> *"Dialogs/sheets: spring scale/slide via AnimatePresence."*

**Neither primitive imports framer-motion** (`grep -c "framer-motion"` → `0` for both). Both animate
purely with `tailwindcss-animate` utilities driven by Radix `data-[state]`:

`components/ui/dialog.tsx:41` —
```
… duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out
data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95
data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]
data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]
```

`components/ui/sheet.tsx:34` —
```
… transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500
data-[state=open]:animate-in data-[state=closed]:animate-out
```

So the *shapes* the spec asks for (scale + slide) are already there — but as **CSS easing, not
springs, and not via AnimatePresence.**

**One thing stands out independently of the spring question:** the sheet opens over
**`duration-500`** — half a second — against *"Nothing should feel slow."* That is worth fixing
whether or not we adopt springs.

**Blast radius:** `Dialog` has **11 consumers** (`DeleteDialog`, `NameDialog`, `ProductDialog`,
`CustomerDialog`, `PaymentDialog`, `DeliveryDialog`, `FarmerDialog`, `MilkSaleDialog`,
`PurchaseDialog`, `DeleteSaleDialog`, `ConfirmDialog`); `Sheet` has **1** (`BottomNav`). Editing
`dialog.tsx` changes 11 screens at once — which is exactly why it is gated on its own below.

---

## STEP 2 — The two-StatCard question

### Side by side

| | `components/shared/StatCard.tsx` | private `StatCard`, `ReportsDashboard.tsx:450` |
|---|---|---|
| **Consumers** | **1** — `DashboardHome.tsx:15` only | 5 tiles in its own file |
| Container | `<Card><CardContent className="p-5">` | plain `<div className="rounded-xl border bg-white p-5 shadow-sm">` |
| Props | `label, value, icon, accent?, format?, trend?, className?` | `label, value, tone, border, hint?, loading, failed?, onRetry?, countUp?` |
| Icon | **required** `ReactNode`, rendered in a tinted tile | **none** |
| Colour | `accent: AccentKey` → the `ACCENTS` map | raw class strings `tone` / `border` |
| Formats | `"money" \| "liters" \| "number"` | **money only** (`formatPKR`) |
| Trend row | **yes** (`trend.value`, ± arrow, emerald/rose) | **no** |
| Loading | **no** | **yes** — `<Skeleton className="mt-3 h-9 w-32" />` |
| Error/retry | **no** | **yes** — "—" plus a "Couldn't load — retry" button |
| **Money display** | **re-implements the count-up**: `useMotionValue(0)` + `useTransform` + `animate(count, value, reduceMotion ? TWEEN.none : TWEEN.countUp)` | **delegates** to `<AnimatedMoney value countUpOnMount />` when `countUp`, else a static `formatPKR(value)` |

All five reports tiles pass `countUp`, so in practice reports always goes through `AnimatedMoney`;
the static branch is unused today but still a live code path.

### Can they converge without a visual change? **No — and the reason is money display.**

Their jobs genuinely differ. A merged component would have to carry `icon`, `trend`, `accent`,
`format` **and** `tone`/`border`, `hint`, `loading`, `failed`, `onRetry`, `countUp` — a prop surface
where roughly half is unused by either caller. That is a smell, not a simplification.

But the blocking issue is narrower and sharper:

> ### 🔴 CONVERGENCE WOULD CHANGE HOW MONEY IS DISPLAYED. FLAGGING LOUDLY.
>
> The two components display money by **different mechanisms**, so any merge must pick one:
>
> - **Merge onto `AnimatedMoney`** → the dashboard's tiles stop using StatCard's own count-up and
>   start using AnimatedMoney's. Same `TWEEN.countUp` (0.7s easeOut), but a different
>   `useMotionValue` seed, a different reduced-motion path, and different `aria-hidden`/`sr-only`
>   markup. **This is the code I just fixed for a reduced-motion money bug** (`beb8de7`), and the
>   `format: "liters" | "number"` cases have no AnimatedMoney equivalent at all.
> - **Merge onto StatCard's inline count-up** → the reports tiles' static branch would begin
>   animating, and `AnimatedMoney`'s proven mount behaviour would be dropped from that screen.
>
> Either direction touches money display on a live screen. **This gets its own gate. It must not be
> bundled into motion polish.**

### Recommendation: **leave them separate, document the duplication.**

Evidence for leaving them: one consumer each; materially different contracts (loading/error vs
icon/trend/format); and no user-visible problem today — the bug that made this worth looking at is
already fixed.

**But do record it.** The duplication is what let the reduced-motion bug survive in one copy after
being fixed in the other, and it is what nearly made me miss it this week. A short note in
CLAUDE.md's Design System — *"there are two StatCards; the shared one is the dashboard's, the
reports one is private and delegates to AnimatedMoney; fix money-display bugs in both"* — costs
nothing and closes the trap.

**If you ever do want convergence**, the smaller, safer version is: make the **shared** StatCard
delegate its money display to `AnimatedMoney` (deleting the second copy of the count-up logic)
*without* merging the components. That removes the duplication that caused the bug while leaving
both contracts intact. It is still a money-display change and still wants its own gate — but it is a
much smaller diff than a true merge. **Not doing it this turn.**

---

## STEP 3 — The plan

Every item states file(s), whether it is a **visual change**, and the spec bullet that justifies it.
Groups are independently approvable; **E and F are deliberately separate so you can drop either
without affecting the rest.**

### Group A — Route/page transition *(decide together with B)*

| # | Change | Files | Visual? | Spec intent |
|---|---|---|---|---|
| A1 | Add `app/(dashboard)/template.tsx` wrapping children in a fade + 8px slide using `enterUp(reduceMotion, TWEEN.page)` | **1 new file** | **YES** — every navigation | *"Page/tab transitions: subtle fade + 8px slide, ~200ms"* |

**My recommendation: do A1, and then do B1 as removal rather than addition** — see B.

### Group B — Section-entrance consistency

| # | Change | Files | Visual? | Spec intent |
|---|---|---|---|---|
| B1 | **Remove** the 6 existing per-screen `enterUp` section entrances, letting the route transition own the entrance | `NewSaleForm`, `MilkHub`, `FarmerProfile`, `FarmerBalanceSheet`, `MilkSalesList`, `ReportsDashboard` | **YES** | *"Purposeful… Nothing should feel slow"* — one entrance per navigation, not two |
| B1-alt | **Instead**, add `enterUp` to the 7 screens that lack it and skip A1 | `DashboardHome`, `SalesList`, `CustomersHub`, `CustomerProfile`, `CatalogManager`, `SettingsForm`, `QuickEntryGrid` | **YES** | *"Page transitions: fade + 8px slide"* approximated per-screen |

**These are alternatives, not both.** A1+B1 is the cleaner architecture — one place defines the
entrance, and the 7 unanimated screens get it for free. B1-alt touches 7 files instead of 1 and
leaves the inconsistency structural. **I recommend A1 + B1.**

### Group C — Tab transitions

| # | Change | Files | Visual? | Spec intent |
|---|---|---|---|---|
| C1 | Wrap `<TabsContent>` bodies in a keyed fade+slide via `AnimatePresence` + `TWEEN.page` | `components/milk/FarmerProfile.tsx`, `components/reports/ReportsDashboard.tsx` | **YES** | *"Page/**tab** transitions: subtle fade + 8px slide, ~200ms"* |

Done in the consuming screens, **not** in `components/ui/tabs.tsx` — keeping clear of #10.

### Group D — List add/remove

| # | Change | Files | Visual? | Spec intent |
|---|---|---|---|---|
| D1 | Wrap sale rows in `AnimatePresence` so a **deleted sale animates out** (rows already have `layout`) | `components/sales/SalesList.tsx` | **YES** | *"List rows: `layout` animation when items are added/removed"* |
| D2 | Add `AnimatePresence` + `layout` + `rowInOut` to the catalog's category/sub-category lists | `components/catalog/CatalogManager.tsx` | **YES** | same |
| D3 | Same for the farmer ledger lists (deliveries, purchases) | `components/milk/FarmerProfile.tsx` | **YES** | same |
| D4 | Same for milk sales | `components/milk/MilkSalesList.tsx` | **YES** | same |
| D5 | Same for the customers list and the balance sheet | `components/customers/CustomersHub.tsx`, `components/milk/FarmerBalanceSheet.tsx` | **YES** | same |

**D1 is the highest value** — deleting a sale is a routine action on a money screen, and it
currently blinks out. **I'd suggest approving D1–D3 and treating D4/D5 as optional**; the balance
sheet and customers list change far less often.

**`QuickEntryGrid` deliberately excluded.** It is the densest screen, used twice daily, and
CLAUDE.md records a real bug in its `seedVersion` reseed logic. Adding layout animation there is
disproportionate risk for the least benefit.

### Group E — Dialog/sheet primitive 🔒 *separate gate — approve or drop on its own*

| # | Change | Files | Visual? | Spec intent |
|---|---|---|---|---|
| E1 | Replace the CSS `animate-in/out` on dialog content with `AnimatePresence` + `SPRING.section` scale/slide | `components/ui/dialog.tsx` | **YES — on all 11 dialog consumers at once** | *"Dialogs/sheets: spring scale/slide via AnimatePresence"* |
| E2 | Same for the sheet | `components/ui/sheet.tsx` (1 consumer, `BottomNav`) | **YES** | same |
| E3 | **Independently of E1/E2:** cut the sheet's `data-[state=open]:duration-500` to ~200ms | `components/ui/sheet.tsx` | **YES** | *"Nothing should feel slow"* |

**My honest read on E1/E2:** the spec asks for it, but the shapes it wants (scale + slide) already
exist in CSS and look fine; the change is *mechanism*, not appearance, and it rewires a Radix
primitive that 11 screens depend on. Converting Radix dialogs to AnimatePresence also means handling
the unmount delay so the exit animation can play, which is where this kind of change usually breaks.
**I'd take E3 on its own and drop E1/E2** unless you specifically want the spring feel — but it is
your call, which is why it is its own group.

### Group F — StatCard duplication 🔒 *separate gate — MONEY DISPLAY*

| # | Change | Files | Visual? | Spec intent |
|---|---|---|---|---|
| F1 | **Documentation only:** note the two StatCards in CLAUDE.md's Design System so a future fix is applied to both | `CLAUDE.md` | **NO** | — |
| F2 | *(optional, own gate)* Make the shared StatCard delegate money display to `AnimatePresence`-free `AnimatedMoney`, deleting the duplicated count-up | `components/shared/StatCard.tsx` | **YES, and it is money display** | — |

**F1 is safe and I recommend it. F2 is money-display code and should not be bundled with motion
work** — see the loud flag in Step 2.

### Group G — CLAUDE.md

| # | Change | Files | Visual? |
|---|---|---|---|
| G1 | Record whatever ships from A–E in the Design System section, in the same commit as the code | `CLAUDE.md` | **NO** |

---

## Suggested order, if you want one

1. **F1** — free, closes a real trap
2. **A1 + B1** — the architectural fix; biggest visible gain, smallest file count
3. **C1** — small, two files
4. **D1** (then D2/D3 if happy)
5. **E3** alone; decide E1/E2 separately
6. **G1** ships with each

---

## Constraint compliance

| Constraint | Status |
|---|---|
| Zero code changes this turn | ✅ `git status`: 0 tracked modifications |
| No money-logic, no `Sale`/`SaleItem`, no Migration B, no receivables | ✅ none read for modification; unified tables untouched |
| No data touched; 2 real sales + Saif safe | ✅ **no database access at all this turn** |
| No dependency installs/removals; stay on framer-motion | ✅ `package.json` not modified |
| #10 / #11 / #12 / dark mode out of scope | ✅ #10 overlap noted in 1C and E, not acted on |
| Documented asymmetries not "balanced" | ✅ `lineItemInOut`'s no-scale entry and the AnimatedMoney/StatCard reduced-motion mechanism appear nowhere in this plan except F2, which is explicitly gated |

**Stopping here for your review.**
