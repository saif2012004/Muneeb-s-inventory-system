# Frontend Elevation — RECON + PLAN ONLY

**Date:** 2026-08-11
**Code changes made: ZERO.** No edits, no installs, no migrations, no data touched. Read-only greps,
file reads, and `git status`. Nothing was written except this document.

---

## STEP 0 — Ground truth

### 0.1 HEAD and working tree — ⚠️ one discrepancy, flagged before proceeding

**HEAD is `62cf0d2`** ✅ — *"fix: server-authoritative unitPrice on sale PATCH (close snapshot hole
#7)"*.

**The tree is NOT strictly clean**, so per your gate, here it is before anything else:

```
tracked modifications: 0
deletions:             0
untracked:             7
```

All seven are response documents I wrote this session and disclosed at the time:

```
?? docs/responses/2026-08-10-migration-b-preflight-STOP.md
?? docs/responses/2026-08-11-committed-and-whats-left.md
?? docs/responses/2026-08-11-delete-guard-findings-step-1.md
?? docs/responses/2026-08-11-frontend-elevation-prompt.md
?? docs/responses/2026-08-11-migration-b-preflight-steps-1-3.md
?? docs/responses/2026-08-11-migration-b-reference-audit.md
?? docs/responses/2026-08-11-snapshot-hole-7-closed.md
```

**Zero tracked modifications and zero deletions** — no code is uncommitted and nothing is missing.
I continued with the read-only recon because the discrepancy is documentation I authored and
nothing here can alter state. Say the word and I'll commit them as a `docs:` commit.

### 0.2 CLAUDE.md — read. One conflict to flag, not reconciled.

**Conflict: CHECKLIST #10 understates the touch-target problem.** It says:

> *"`shadcn TabsTrigger` measures **28px** and inline back-links **20px** … Everything else measured
> clean — inputs, buttons and cards are all ≥44px."*

The first half is right. **The second half is not.** Read from the primitives (§1.4): `Button`'s
default size is `h-9` (**36px**) and `Input` is `h-9` (**36px**). They reach 44px only where a call
site overrides with `h-11` — which 151 occurrences do, and **84 `<Button>` / 40 `<Input>` usages do
not**.

Flagging per instruction; **not fixing, and not editing CLAUDE.md.** It affects #10's scope, not
this pass.

Everything else in the Design System I checked is accurate: zinc base, module accents
blue/amber/emerald, `rounded-xl` cards, `shadow-sm` resting, 44px target rule, motion principles,
reduced-motion requirement, and the receipt/screen precision asymmetry.

### 0.3 The draft prompt — three verbatim excerpts

**Objective:**

> **PHASE 8 — FRONTEND ELEVATION. Bounded pass, not a redesign.**
>
> Read CLAUDE.md's Design System section first — it is the spec, not a suggestion. This task
> *elevates within* it. If you find yourself wanting to change the palette, the radius scale, the
> type scale, or the module accent mapping, STOP and ask; that is a Design System amendment, not
> this task.

**Gated decision (a):**

> - **Dark mode.** It does not exist (zero `dark:` classes). Adding it touches every screen and is a
>   large surface for a closeout phase. Note that the Design System's stated user is *"a shop owner
>   using a cheap Android phone in bright daylight"* — which argues for refining the light theme
>   rather than shipping a dark one. **Tell me your recommendation and wait.** If we do want it, it
>   becomes its own gated item, not part of this pass.

**Gated decision (b):**

> - **`framer-motion` vs `motion`.** The motion.dev guidance says to import from `motion/react` and
>   never `framer-motion`. This project is on `framer-motion` and CLAUDE.md documents that.
>   Migrating is mechanical but touches all 13 components. **Recommend, then wait** — and if we
>   migrate, it is its own commit, separate from the elevation, so a regression is attributable.

*(One correction to my own draft, found in recon: it says "zero `dark:` classes", which is true of
app code — but `app/globals.css` **does** already carry a full `.dark` token block. See §2a.)*

---

## STEP 1 — Recon of the actual frontend

### 1.1 Where the Design System actually lives

| Layer | File | Nature |
|---|---|---|
| Theme tokens | `app/globals.css` `:root` + `.dark` | shadcn HSL CSS variables |
| Tailwind wiring | `tailwind.config.ts` | `darkMode: ["class"]`, content globs incl. `./lib` |
| Module accents | `lib/nav.ts` → `ACCENTS` | **hardcoded Tailwind class strings** |
| Font | `app/layout.tsx` | `Inter` via `next/font/google` ✅ matches spec |
| Primitives | `components/ui/*` (23 files) | shadcn, token-driven |
| Reduced motion | `app/globals.css:87` | `@media (prefers-reduced-motion: reduce)` |

**`app/globals.css` — tokens exist, both themes:**

```css
:root {
  --background: 0 0% 98%;      /* zinc-50, per the Design System */
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --muted-foreground: 240 3.8% 46.1%;
  --border: 240 5.9% 90%;
  --radius: 0.5rem;
  …
}
.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  …                            /* a COMPLETE dark set already present */
}
```

**`lib/nav.ts` — accents are literal classes, not tokens:**

```ts
export const ACCENTS = {
  …
  text:  "text-blue-600",
  icon:  "bg-blue-50 text-blue-600",
  solid: "bg-blue-600",
  …     "text-amber-600" … "text-emerald-600"
};
```

*(This is why `tailwind.config.ts`'s content globs must include `./lib` — CLAUDE.md records that
trap, and it still holds.)*

#### The critical measurement: hardcoded vs token-driven

| | Occurrences |
|---|---|
| **Hardcoded palette utilities** (`bg-/text-/border-…-{zinc,blue,amber,emerald,rose,…}-{n}`) | **465** across **38 files**, 44 distinct classes |
| **Semantic token utilities** (`bg-background`, `text-muted-foreground`, …) | **140** |

Roughly **3:1 hardcoded to semantic**. The shadcn primitives consume tokens; the app-level
components do not. Most hardcoded files:

```
components/reports/ReportsDashboard.tsx   38      components/sales/SalesList.tsx        16
components/milk/FarmerBalanceSheet.tsx    31      components/sales/LineItemRow.tsx      15
components/milk/MilkHub.tsx               30      components/catalog/ProductTable.tsx   14
components/milk/FarmerProfile.tsx         27      components/milk/QuickEntryGrid.tsx    12
components/sales/NewSaleForm.tsx          21      components/sales/SaleLineItems.tsx    10
components/milk/MilkSalesList.tsx         17      components/customers/CustomerProfile  10
```

### 1.2 Animation — read from `package.json`, not inferred

```
dependencies:
  framer-motion    ^12.43.0        resolved: 12.43.0
  "motion" entry present: False    motion: NOT INSTALLED
```

**Only `framer-motion` exists. There is no `motion` package**, in either dependency section, and
nothing imports one.

**Every file that animates — 13, each importing from `"framer-motion"`:**

| File | Imports |
|---|---|
| `components/auth/login-form.tsx` | `motion, useReducedMotion` |
| `components/catalog/ProductTable.tsx` | `AnimatePresence, motion, useReducedMotion` |
| `components/milk/FarmerBalanceSheet.tsx` | `motion, useReducedMotion` |
| `components/milk/FarmerProfile.tsx` | `motion, useReducedMotion` |
| `components/milk/MilkHub.tsx` | `motion, useReducedMotion` |
| `components/milk/MilkSalesList.tsx` | `motion, useReducedMotion` |
| `components/reports/ReportsDashboard.tsx` | `motion, useReducedMotion` |
| `components/sales/NewSaleForm.tsx` | `AnimatePresence, motion, useReducedMotion` |
| `components/sales/SalesList.tsx` | `AnimatePresence, motion, useReducedMotion` |
| `components/shared/AnimatedMoney.tsx` | `animate, motion, useMotionValue, useReducedMotion, useTransform` |
| `components/shared/BottomNav.tsx` | `motion, useReducedMotion` |
| `components/shared/Sidebar.tsx` | `motion, useReducedMotion` |
| `components/shared/StatCard.tsx` | `motion, useReducedMotion, …` |

**`useReducedMotion()` appears in all 13** — coverage is genuinely good, plus the CSS backstop.

#### Where motion is inconsistent — the actual evidence

Every transition is hand-rolled at its call site. **Six distinct spring configs expressing about
three intents:**

```
stiffness 500 / damping 40   ProductTable.tsx:81, BottomNav.tsx:40
stiffness 480 / damping 38   NewSaleForm.tsx:410
stiffness 480 / damping 40   SalesList.tsx:371
stiffness 420 / damping 34   FarmerBalanceSheet:225, FarmerProfile:236, MilkHub:204,
                             MilkSalesList:164, ReportsDashboard:184, NewSaleForm:300
stiffness 400 / damping 40   SalesList.tsx:432
stiffness 380 / damping 40   AnimatedMoney.tsx:93-95
```

**Three distinct durations:**

```
duration 0.2  / easeOut   login-form.tsx:100, Sidebar.tsx:22
duration 0.15             login-form.tsx:211
duration 0.7  / easeOut   AnimatedMoney.tsx:91, StatCard.tsx:67
```

`420/34` is clearly the intended "page/section enter" and is already used six times — the others
look like drift rather than deliberate difference. **No `lib/motion.ts` exists.**

### 1.3 Shared component inventory this pass would touch

**`components/ui/` (23 shadcn primitives):** accordion, avatar, badge, button, calendar, card,
collapsible, command, dialog, dropdown-menu, form, input, label, popover, select, separator, sheet,
skeleton, sonner, switch, table, tabs, tooltip.

**`components/shared/` (9):** `AnimatedMoney`, `BottomNav`, `ConfirmDialog`, `EmptyState`,
`ExportCsvButton`, `MoneyText`, `PageHeader`, `Sidebar`, `StatCard`.

**Three-states coverage** (the Design System's quality bar) is already broad:
Skeleton in **17** files, `EmptyState` in **14**, error/retry in **15**. This pass would make them
consistent, not build them.

### 1.4 Touch-target reality — reported, NOT fixed

Read from the primitives:

| Primitive | Default | vs 44px spec |
|---|---|---|
| `TabsList` | `h-9` = **36px**, with `p-1` | — |
| **`TabsTrigger`** | `px-3 py-1 text-sm`, no height → **≈28px** | ❌ **the known issue** |
| **`Button` default** | `h-9` = **36px** | ❌ **not recorded in CLAUDE.md** |
| `Button` sm / lg / icon | `h-8` (32px) / `h-10` (40px) / `h-9` | ❌ |
| **`Input`** | `h-9` = **36px** | ❌ **not recorded** |

**Overlap with #10, quantified:** 151 `h-11` overrides already exist across the app (screens
patching individually), while **84 `<Button>` and 40 `<Input>` usages carry no height override** and
sit at 36px.

The fix stays centralised — change the defaults in `button.tsx`, `input.tsx`, `tabs.tsx` — but it is
larger than "override `TabsTrigger` once". **Out of scope here. Not touched.**

---

## STEP 2 — The two decisions, framed with evidence

### (a) DARK MODE — token layer ready, consumption layer is not

**The tradeoff, grounded in §1.1:**

*Cheaper than expected:* `app/globals.css` already ships a **complete `.dark` token block**,
`tailwind.config.ts` already sets `darkMode: ["class"]`, `next-themes@^0.4.6` is already installed,
and all 23 shadcn primitives already consume tokens. The foundation is done.

*More expensive than expected:* the app-level components don't use those tokens. **465 hardcoded
palette utilities across 38 files** would each need either a `dark:` counterpart or conversion to a
semantic token. Plus `ACCENTS` in `lib/nav.ts` is literal classes, so module accents need dark
variants too.

**Rough quantification:** ~465 values / 38 files, dominated by ~12 components. Realistically a
multi-session refactor touching nearly every screen, and each one needs re-verifying in a browser
because a missed value shows up as unreadable text rather than a crash.

**Recommendation: NO dark mode in this pass, and probably not before handoff.** The Design System's
stated user is *"a shop owner using a cheap Android phone in bright daylight"* — the light theme is
the one that matters for that context, and this is a closeout phase. The right use of this pass is
to make the light theme genuinely good.

**A cheaper middle option, if you want the door open:** as part of the elevation, convert
hardcoded values to semantic tokens *only in the shared shell* — `Sidebar`, `BottomNav`,
`PageHeader`, `StatCard`, `EmptyState` (~5 files). That's a real quality win on its own (one place
defines chrome colour), and it makes a later dark-mode decision materially cheaper without
committing to it now.

### (b) FRAMER-MOTION vs MOTION

**What's installed:** `framer-motion@^12.43.0` (resolved 12.43.0). **`motion` is not installed** —
no entry in `dependencies` or `devDependencies`, nothing imports it.

**What's imported:** 13 files, all `from "framer-motion"`. Surface used is small and stable —
`motion`, `AnimatePresence`, `useReducedMotion`, plus `animate`/`useMotionValue`/`useTransform` in
`AnimatedMoney`.

| | `framer-motion` (stay) | `motion` (migrate) |
|---|---|---|
| Install churn | none | add `motion`, remove `framer-motion` |
| Code churn | none | 13 import lines |
| API | identical — `motion` is the same library, renamed at v11+ | identical |
| Bundle | equivalent; both tree-shake the same way | marginal at best |
| Tooling | motion.dev guidance says use `motion/react` | aligns with it |
| CLAUDE.md | documents Framer Motion | needs a doc update |
| Risk | zero | low, but touches every animated file |

**Recommendation: STAY on `framer-motion` for this pass.** The APIs are identical, so migrating buys
naming alignment and nothing functional, while touching all 13 animated files during the one pass
that is *also* changing their animations — which is exactly how a regression becomes unattributable.

**If you want the migration**, do it as its own mechanical commit **before or after** the elevation,
never inside it: 13 import lines, one dependency swap, one CLAUDE.md line. It's a 20-minute change
when it isn't tangled with anything else.

---

## STEP 3 — The plan

Presentation only. Grouped so you can approve, run and verify chunk by chunk. **No chunk touches
money logic, `Sale`/`SaleItem`, receivables, or data.**

### Chunk 1 — Extract the motion vocabulary *(the core win; no visual change intended)*

**New:** `lib/motion.ts` — named durations, the ~3 real spring intents, and shared variants (page
enter, list row, dialog/sheet, stat count-up), each already reduced-motion-aware so a component
cannot forget.

**Then adopt it, replacing hand-rolled values (13 files):**

```
components/shared/Sidebar.tsx          components/milk/MilkHub.tsx
components/shared/BottomNav.tsx        components/milk/MilkSalesList.tsx
components/shared/StatCard.tsx         components/milk/FarmerProfile.tsx
components/shared/AnimatedMoney.tsx    components/milk/FarmerBalanceSheet.tsx
components/auth/login-form.tsx         components/reports/ReportsDashboard.tsx
components/catalog/ProductTable.tsx    components/sales/SalesList.tsx
                                       components/sales/NewSaleForm.tsx
```

⚠️ **`AnimatedMoney.tsx` is the one to treat carefully** — count-up on money has a bug history here,
and `:80`'s `animate(amount, value, { duration: 0 })` (rather than `amount.set`) looks deliberate.
I'd read its comments and preserve the mechanism, changing only the shared timing values.

**Verify:** every animated screen still animates identically; reduced-motion suppresses; no console
warnings.

### Chunk 2 — Motion polish within the Design System

Apply the spec's stated intents consistently now that the vocabulary exists: page/tab transitions
(fade + 8px slide, ~200ms), `layout` animation on list add/remove, spring dialog/sheet entrances via
`AnimatePresence`.

**Files:** the same 13, plus `components/ui/dialog.tsx` and `components/ui/sheet.tsx` if we want
their entrances springy rather than CSS-transitioned *(flagging that as a primitive change — say if
you'd rather I didn't)*.

### Chunk 3 — Theme consistency in the shared shell *(light theme only)*

Convert hardcoded palette values to semantic tokens in the chrome:
`components/shared/Sidebar.tsx`, `BottomNav.tsx`, `PageHeader.tsx`, `StatCard.tsx`,
`EmptyState.tsx`. ~5 files. One place defines chrome colour, and it de-risks any future dark-mode
decision without making one.

**Not included:** the other 33 hardcoded files. That's the dark-mode refactor, gated on (a).

### Chunk 4 — Three-states consistency

Audit the 17 Skeleton / 14 EmptyState / 15 error-state files for gaps and inconsistent copy, and
elevate the transitions between states using Chunk 1's vocabulary. Report gaps before filling them —
a missing empty state is a small feature, not polish.

### Chunk 5 — CLAUDE.md

Add the motion vocabulary to the Design System section: the named durations/springs and where they
live, so a fresh session extends it rather than hand-rolling a seventh spring config. Ships in the
same commit as Chunk 1, per the process rule.

### Explicitly NOT in this plan

- Touch targets (#10) — reported in §1.4, untouched
- PWA (#11), date locale (#12), on-device (#13)
- Dark mode — gated on (a)
- `motion` migration — gated on (b)
- Any change to `lib/sales.ts`, `lib/receipt.ts`, `components/receipt/*`, `lib/format.ts`,
  `lib/receivables.ts`, or any API route

### Verification for every chunk

Browser, real data, every module (dashboard, beverages, bakery, milk — quick-entry especially,
customers, catalog, reports, settings), at 360px and desktop, with reduced-motion on and off. Plus a
`ZZ_TEST_` discounted sale end-to-end confirming line total, bill discount, stock and the printed
receipt are unchanged — then cleaned up. **2 real sales (bakery Rs. 5,000, milk Rs. 6,000) and
1 customer (Saif) never touched.**

---

## Constraint compliance

| Constraint | Status |
|---|---|
| No money-logic changes | ✅ nothing changed at all |
| No `Sale`/`SaleItem` read/write/wire | ✅ not touched; still dormant |
| No Migration B | ✅ not run |
| No receivables code touched | ✅ |
| No live data modified | ✅ no writes; the only DB access this turn was none — recon was filesystem-only |
| No dependency installs/removals | ✅ `package.json` read only |
| Zero code changes | ✅ `git status` shows 0 tracked modifications |

**Stopping here for your review of the two decisions and the chunk grouping.**
