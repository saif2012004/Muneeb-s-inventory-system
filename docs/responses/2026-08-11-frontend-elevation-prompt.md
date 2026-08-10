# Frontend Elevation — the prompt you asked for, plus a state correction to feed back

**Date:** 2026-08-11
**Deliverable:** §2 is the paste-ready prompt. §1 is a correction to your "where we are", because
several of its premises don't match this repo and they're shaping the prompts you write.

---

## 1. State correction — please paste this back into your reviewer first

Your brief says all irreversible work is done. **Migration B has not run**, and two other premises
are off. Verified in the repo minutes ago:

| Your brief says | Actually |
|---|---|
| "Migration B (old BeverageSale/BakerySale tables dropped)" | **Not done.** All 4 models still in `schema.prisma`; tables still in the DB; **54 live code references** across 9 files |
| "unified Sale is now the only sale model" | **Inverted.** Zero code reads `Sale`/`SaleItem`; there is no `/sales` route. The app runs on `/beverages/new-sale` and `/bakery/new-sale` against the old tables |
| "customer-delete guard repointed to it and verified" | **Not repointed** (`git diff lib/catalog-guards.ts` is empty). Also: there *is* no customer-delete guard — customer DELETE is an unconditional soft-delete that queries no sale table and has no UI control. The guard that reads sale tables is the **product/category** guard |
| "Product.discountPercent column drop … DONE" | **Migration applied and browser-verified, but UNCOMMITTED.** Last commit is `873054e`, the login fix |
| "no receivables — a sale is just revenue" | `lib/receivables.ts` is live with 8 Prisma calls, and `/api/customers/[id]/balance` exists |
| "5 exploratory sales / 3 customers" | **2 sales, 1 customer.** Bakery Rs. 5,000, milk Rs. 6,000, customer `Saif`. `BeverageSale` is empty |
| "Context7 has failed ~10 sessions" | **Context7 is up** — used successfully this session; `/prisma/prisma/__branch__6.19.x` resolves |
| "local prod builds OOM" | `npm run build` **completed green** on 2026-08-10. What OOM'd was `tsc --noEmit` at default heap; it passes with `NODE_OPTIONS=--max-old-space-size=4096` |

**Why this matters for sequencing:** the frontend elevation below is genuinely additive and safe to
do now regardless. But the two items your brief believes are closed are not, and the sales/customer
counts are the ones that size the **data reset** — a delete set written for "5 sales / 3 customers"
would target rows that don't exist.

**Also uncommitted right now:** the `discountPercent` drop (applied migration + 13 code files +
CLAUDE.md updates). Worth committing before starting a frontend pass, so the elevation diff lands
on a clean tree.

---

## 2. THE PROMPT — paste this to Claude Code

---

**PHASE 8 — FRONTEND ELEVATION. Bounded pass, not a redesign.**

Read CLAUDE.md's Design System section first — it is the spec, not a suggestion. This task
*elevates within* it. If you find yourself wanting to change the palette, the radius scale, the
type scale, or the module accent mapping, STOP and ask; that is a Design System amendment, not this
task.

**Before any code: reconnaissance, and report back.** I want the plan before the diff.

**What already exists (don't rediscover it, confirm it):**
- `framer-motion@^12.43.0`, used by **13 components**: `login-form`, `ProductTable`,
  `FarmerBalanceSheet`, `FarmerProfile`, `MilkHub`, `MilkSalesList`, `ReportsDashboard`,
  `NewSaleForm`, `SalesList`, `AnimatedMoney`, `BottomNav`, `Sidebar`, `StatCard`.
- `useReducedMotion()` is already called in **all 13** — coverage is good. Plus a CSS-level
  `@media (prefers-reduced-motion: reduce)` block at `app/globals.css:87`.
- **No shared motion constants.** Every component hand-rolls its own durations and easings. This is
  the single biggest source of inconsistency and the highest-value, lowest-risk thing to fix.
- `next-themes@^0.4.6` is installed and `darkMode: ["class"]` is set in `tailwind.config.ts`, but
  **no ThemeProvider is wired and there are zero `dark:` classes** anywhere. Dark mode does not
  exist today.

### Scope — do these

1. **Extract a shared motion vocabulary** into `lib/motion.ts`: named durations, easings/springs,
   and the handful of reusable variants (page enter, list row, dialog/sheet, stat count-up). Then
   adopt it across the 13 components so timings stop drifting. Encode the Design System's motion
   rules in it — page/tab transitions ~200ms fade + 8px slide, spring-based dialogs, `layout`
   animation on list add/remove. **One implementation, the way `lib/sales.ts` owns the money maths.**
2. **Make reduced-motion structural rather than per-component.** Right now each component checks
   `useReducedMotion()` and branches. Fold that into the shared variants so a component cannot
   forget it. Keep the CSS block as the backstop.
3. **Tighten the existing light theme within the spec** — accent usage consistency (blue/amber/
   emerald, never mixed on one screen), `shadow-sm` resting elevation, 12px card / 8px control
   radius, `tabular-nums` on every number, 4px spacing rhythm, card padding 16–20px. Fix drift where
   you find it; do not invent new tokens.
4. **Polish the three states every list/table must have** — loading (Skeleton), empty (friendly
   message + primary action), error (retry). CLAUDE.md requires all three; verify each one actually
   exists on each list and elevate the motion between them.

### Two decisions to bring me BEFORE implementing — do not choose these yourself

- **Dark mode.** It does not exist (zero `dark:` classes). Adding it touches every screen and is a
  large surface for a closeout phase. Note that the Design System's stated user is *"a shop owner
  using a cheap Android phone in bright daylight"* — which argues for refining the light theme
  rather than shipping a dark one. **Tell me your recommendation and wait.** If we do want it, it
  becomes its own gated item, not part of this pass.
- **`framer-motion` vs `motion`.** The motion.dev guidance says to import from `motion/react` and
  never `framer-motion`. This project is on `framer-motion` and CLAUDE.md documents that. Migrating
  is mechanical but touches all 13 components. **Recommend, then wait** — and if we migrate, it is
  its own commit, separate from the elevation, so a regression is attributable.

### Hard no-touch list — money-critical, do not modify behaviour

- `lib/sales.ts` — `reconcileSaleLines`, `computeLineTotal`, `applySaleDiscount`,
  `computeStockDeltas`. Snapshot integrity is load-bearing.
- `lib/receipt.ts`, `components/receipt/*`, `lib/settings-display.ts` — **the receipt is a print
  document. Do not animate it.** `formatPKR(v, { precise: true })` must remain in exactly one place
  (`ReceiptDocument.tsx`); the receipt prints paise while the screen shows whole rupees, and that
  asymmetry is deliberate.
- `lib/format.ts` — do not change `formatPKR`, date formatting, or the Karachi helpers.
- The sale/stock/discount API routes under `app/api/`.

**Specific trap: `components/shared/AnimatedMoney.tsx`.** Count-up on money has already produced
two real bugs in this project — a formatting break, and a Recharts entrance animation freezing at
5%. If you touch it, verify the displayed value equals the stored value at rest, with a real
discounted sale, not a placeholder number.

### Also out of scope (they are separate Phase 8 items)

Touch targets (28px `TabsTrigger` → 44px), PWA, date-input locale. **Don't fold them in.** If you
edit `components/ui/tabs.tsx` for theming, do not silently change its sizing either way — say so.

### Verification — browser, with real data

A green build proves nothing here; this project has shipped three real bugs past clean builds.

- Run the app and check **every module**: dashboard, beverages, bakery, milk (quick-entry
  especially — it is the densest screen), customers, catalog, reports, settings.
- At **360px** as well as desktop.
- **With reduced-motion enabled**, confirm animation is suppressed and nothing becomes unusable or
  invisible.
- Create a **`ZZ_TEST_`-prefixed discounted sale** end to end and confirm the numbers are unchanged
  — line total, bill discount, stock decrement, and the printed receipt in paise. Then clean up the
  `ZZ_TEST_` rows.
- **Never delete real data.** There are **2 real sales** (bakery Rs. 5,000, milk Rs. 6,000) and
  **1 customer** (`Saif`) — not the 5/3 that earlier briefs have said. Verify before removing
  anything.
- Report console errors and any hydration warnings.

### Finish

Update CLAUDE.md's Design System section with the motion vocabulary you established — the named
durations/easings and where they live — so a fresh session extends it instead of hand-rolling new
timings. Per the process rule, that edit ships in the same commit as the code.

**Show me the recon + plan + the two decisions first. Do not start implementing until I reply.**

---

## 3. Why the prompt is shaped this way

- **Recon-then-plan gate.** Matches your stop-and-confirm preference and prevents an open-ended
  redesign, which is the main risk in a prompt containing the word "elevation".
- **The motion-vocabulary extraction is the real win.** 13 components each hand-rolling durations
  is exactly the kind of drift CLAUDE.md exists to prevent, and consolidating it is additive,
  reviewable, and can't touch money logic.
- **Dark mode is deliberately escalated, not assigned.** Zero `dark:` classes means it's a
  whole-app change, and the Design System's own user description argues against it. That's a
  decision for you, not a default for Claude Code.
- **The framer-motion/motion split is called out** because the motion.dev tooling actively tells
  agents to use `motion/react` — left unstated, an agent may migrate the package mid-task and
  bundle it with unrelated changes.
- **The no-touch list names files, not concepts.** "Don't touch money logic" is ignorable;
  "don't modify `lib/sales.ts`" is not.
- **AnimatedMoney is called out by name** because it has a bug history, and count-up is precisely
  what an elevation pass would reach for.
- **The 2-sales/1-customer correction is inside the prompt**, so the cleanup step can't be sized
  from the wrong figure.

---

## 4. Housekeeping for this repo

- **Nothing changed by this task** — recon only: greps and one `git diff --stat`. No code, schema,
  migration, or data touched.
- **Still uncommitted:** item #9 (the applied `discountPercent` migration, 13 code files, CLAUDE.md
  updates). Verified 2026-08-10 and waiting on a go. I'd commit it before the elevation starts so
  the two diffs stay separable.
- **Database unchanged:** 27 products, `Saif`, 1 bakery sale, 1 milk sale, 1 owner account. No
  `ZZ_TEST_` rows outstanding.
- **Still open and unaffected by any of this:** Migration B (blocked on CHECKLIST #4), the data
  reset, and real shop details — `Settings.configuredAt` is still `NULL` with the
  `SET SHOP NAME IN SETTINGS` placeholders intact.
