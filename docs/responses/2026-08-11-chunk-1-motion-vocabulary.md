# Chunk 1 + Chunk 5 — shared motion vocabulary, shipped

**Date:** 2026-08-11
**Commits:** `caa1d78` (docs) and `60437a5` (motion) — both pushed to `main`
**Stopping here before Chunk 2**, as instructed.

---

## STEP A — Verification gate: PASSED

### A.1 next-themes — `.dark` is DORMANT and cannot activate at runtime

**There is no `ThemeProvider` mounted anywhere.** The entire repo contains exactly one
`next-themes` reference:

```
components/ui/sonner.tsx:3:import { useTheme } from "next-themes"
```

`app/layout.tsx` in full, verbatim at the mount point:

```tsx
return (
  <html lang="en" className={inter.variable}>
    <body className={cn("min-h-dvh bg-background font-sans antialiased")}>
      <QueryProvider>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </QueryProvider>
    </body>
  </html>
);
```

No provider, no `attribute`, no `defaultTheme`, no `enableSystem`, no `forcedTheme`, and no
`suppressHydrationWarning` (which next-themes requires). `components/providers/` contains only
`query-provider.tsx`.

**Answer, plainly: `.dark` CANNOT activate today.** Nothing ever adds the class to `<html>`, and
Tailwind's `darkMode: ["class"]` means the dark tokens in `globals.css` are only emitted under
`.dark`. **No live half-dark rendering bug.**

*Minor note, not a blocker:* `sonner.tsx:9` reads `const { theme = "system" } = useTheme()` and
passes it to `<Sonner theme="system">`. With no provider, `useTheme()` yields the `"system"`
default, and Sonner's own theming does respond to `prefers-color-scheme`. But the `classNames`
override pins the toast to `bg-background`/`text-foreground` — Tailwind tokens that resolve light
because `.dark` never activates. Worth an eyeball on a dark-set device someday; nothing to fix now.

### A.2 cva size defaults — verbatim, and they CONFIRM the recon

**`components/ui/button.tsx`:**
```ts
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
```

**`components/ui/input.tsx`:**
```
"flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm …"
```

**`components/ui/tabs.tsx`:**
```
TabsList:    "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground"
TabsTrigger: "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium …"
```

`TabsTrigger` sets **no height at all** — only `px-3 py-1 text-sm` — inside an `h-9` list with
`p-1`, which is the ~28px. **Recon confirmed: 36px / 36px / ≈28px.** Both gate conditions met, so I
proceeded.

---

## STEP B — Commit A: `caa1d78`

```
docs: track session response docs; correct #10 touch-target measurement
9 files changed, 2038 insertions(+), 2 deletions(-)
```

**8 docs staged, not 7** — the frontend-elevation recon-and-plan was written after your count was
taken. Flagged in the commit message.

**The single CLAUDE.md correction**, exactly as scoped — the false sentence in CHECKLIST #10
replaced with the verified defaults, a table of the three primitives, and the 151 `h-11` overrides
vs ~84 `<Button>` / ~40 `<Input>` at 36px. **Nothing else in CLAUDE.md touched in that commit**, and
**no touch-target fix made** — #10 stays open and unstarted.

---

## STEP C — Commit B: `60437a5`

```
refactor: extract shared motion vocabulary (lib/motion.ts); adopt in 13 components
15 files changed, 323 insertions(+), 71 deletions(-)
```

### `lib/motion.ts`

| Export | Value | Use |
|---|---|---|
| `SPRING.section` | 420 / 34 | **canonical** — a section/card arriving (was used 6×) |
| `SPRING.snap` | 500 / 40 | bottom-nav indicator, catalog rows |
| `SPRING.lineItem` | 480 / 38 | sale line added/removed |
| `SPRING.saleRow` | 480 / 40 | sale row reflowing (`layout="position"`) |
| `SPRING.collapse` | 400 / 40 | height 0 ↔ auto |
| `SPRING.money` | 380 / 40, `restDelta: 0.5` | money figure to a NEW value |
| `TWEEN.fast / page / countUp / none` | 0.15 / 0.2 easeOut / 0.7 easeOut / 0 | |

Helpers take `reduceMotion` and handle it internally so a component cannot forget it: `enterUp`,
`enterLeft`, `rowInOut`, `lineItemInOut`, `collapseInOut`, `feedbackIn`, `indicatorTransition`,
`moneyTransition`.

### ⚠️ One judgement call I made — please sanity-check it

**I did NOT merge the near-duplicate springs.** `lineItem` (480/38), `saleRow` (480/40) and
`collapse` (400/40) are close enough that merging is tempting, and your plan said "the 420/34
section enter is the canonical one" — but it also said **"Intent: NO visual change."**

Merging them *is* a visual change, small but real. So I named each distinct config and merged
nothing. The vocabulary still achieves the goal — one file, named intents, no magic numbers at call
sites — and the do-not-merge reasoning is recorded in both `lib/motion.ts` and CLAUDE.md so it's a
deliberate future decision rather than drift. **Say if you'd rather I collapse them; that's a Chunk
2-shaped change with a browser check.**

### Chunk 5 — CLAUDE.md Design System

Added the vocabulary table, the helper list, the usage snippet, and the do-not-merge note. In the
same commit as the code, per the process rule.

---

## The four required diffs

### 1. `components/sales/NewSaleForm.tsx` — transition props only

```diff
+import { enterUp, lineItemInOut } from "@/lib/motion";

         <motion.div
-          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
-          animate={{ opacity: 1, y: 0 }}
-          transition={{ type: "spring", stiffness: 420, damping: 34 }}
+          {...enterUp(reduceMotion)}
           className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm"

                     <motion.div
                       key={field.id}
                       layout={reduceMotion ? false : "position"}
-                      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
-                      animate={{ opacity: 1, y: 0 }}
-                      exit={
-                        reduceMotion
-                          ? { opacity: 0 }
-                          : { opacity: 0, y: 8, scale: 0.98 }
-                      }
-                      transition={{ type: "spring", stiffness: 480, damping: 38 }}
+                      {...lineItemInOut(reduceMotion)}
                     >
```

No handlers, no calculation, no submit logic, no state.

> **Caught during the work:** my first draft of `lineItemInOut` added `scale: 0.98` to `initial` for
> symmetry with `exit`. The real code has no scale on entry. That would have been a visual change, so
> the helper was corrected to reproduce the asymmetry exactly, with a comment saying not to
> "balance" it.

### 2. `components/sales/SalesList.tsx` — transition props only

```diff
+import { collapseInOut, SPRING } from "@/lib/motion";

               <motion.article
                 key={sale.id}
                 layout={reduceMotion ? false : "position"}
-                transition={{ type: "spring", stiffness: 480, damping: 40 }}
+                transition={SPRING.saleRow}

                     <motion.div
                       id={`sale-items-${sale.id}`}
                       key="items"
-                      initial={reduceMotion ? false : { height: 0, opacity: 0 }}
-                      animate={{ height: "auto", opacity: 1 }}
-                      exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
-                      transition={{ type: "spring", stiffness: 400, damping: 40 }}
+                      {...collapseInOut(reduceMotion)}
                       className="overflow-hidden"
```

### 3. `components/shared/AnimatedMoney.tsx` — mechanism preserved

```diff
+import { moneyTransition, TWEEN } from "@/lib/motion";

     if (reduceMotion) {
       hasAnimated.current = true;
-      const controls = animate(amount, value, { duration: 0 });
+      const controls = animate(amount, value, TWEEN.none);
       return () => controls.stop();
     }

+    // TWEEN.countUp on the first run, SPRING.money thereafter
     const controls = animate(
       amount,
       value,
-      isFirstRun && countUpOnMount
-        ? { duration: 0.7, ease: "easeOut" }
-        : { type: "spring", stiffness: 380, damping: 40, restDelta: 0.5 }
+      moneyTransition(reduceMotion, isFirstRun && countUpOnMount)
     );
```

**The deliberate mechanism is intact:** still `animate(amount, value, …)` on the reduced-motion path,
**never** `amount.set(value)`. `TWEEN.none` *is* `{ duration: 0 }`. `useMotionValue`, `useTransform`,
the `hasAnimated` ref, the `aria-hidden` + `sr-only` pair — all untouched. The rest of the diff is
the docblock, updated to name the constants.

### 4. `components/sales/LineItemRow.tsx` — **NO DIFF**

```
$ grep -c "framer-motion" components/sales/LineItemRow.tsx
0
```

It imports no motion library and animates nothing, so there was nothing to change. Reporting it
explicitly since you asked for its diff.

---

## Verification results

| Check | Result |
|---|---|
| `tsc --noEmit` (4096 heap) | **exit 0** — default heap does OOM, as you noted |
| `next lint` | **clean** |
| `npm run build` | **green**, full route table emitted |
| All 9 routes | **200**, no error markup |
| Console errors/warnings | **zero** |
| Section enter still animates | measured mid-flight: `translateY(8px)` → `translateY(0.047px)` → settled |
| Sale expand/collapse | works — `collapseInOut` + `SPRING.saleRow` |
| 360px | **no horizontal overflow**, bottom nav intact |
| `ZZ_TEST_` discounted sale | 3 × 275.50 → 10% line → **743.85** → 5% bill → **706.66**; stock 100→**97** |
| Screen (rounds) | `10% off · 3 × Rs. 276` → `Rs. 744`, bill discount `−Rs. 37`, total `Rs. 707` |
| Receipt (paise) | `3 × 275.50  Rs. 743.85` / `Discount (5%) -Rs. 37.19` / `TOTAL Rs. 706.66` |
| Cleanup | all `ZZ_TEST_` rows removed; **product fingerprint `95794a0b…` matches baseline** |
| Real data | 27 products, `Saif`, bakery Rs. 5,000, milk Rs. 6,000, 1 owner — **untouched** |

---

## Two things to flag

### 1. A pre-existing hydration mismatch, visible only under reduced motion

While emulating reduced motion I hit:

```
Warning: Prop `style` did not match.
  Server: "opacity:0;transform:translateX(-12px)"
  Client: "opacity:1;transform:none"
  at aside → MotionDOMComponent → Sidebar
```

**This is not a regression.** The server has no `matchMedia`, so `useReducedMotion()` is falsy there
and SSR renders the travelling `initial`; the client with reduced motion renders `initial: false`.
The props my refactor emits are *identical* to what was inline — visible in the Sidebar diff:
`enterLeft(reduceMotion)` returns exactly `initial: reduceMotion ? false : { x: -12, opacity: 0 }`,
`animate: { x: 0, opacity: 1 }`, `transition: { duration: 0.2, ease: "easeOut" }`.

I started an A/B against the stashed baseline to prove it empirically, but the dev server was killed
mid-test. **I restored the stash immediately and re-verified all 14 files came back.** I can re-run
that A/B if you want it evidenced rather than reasoned — say the word. Either way it looks like its
own small item (the usual fix is `suppressHydrationWarning` on the animated element, or gating the
`initial` on a mounted flag), not part of this pass.

### 2. `StatCard` uses `count.set(value)` on its reduced-motion path

`AnimatedMoney`'s docblock records a real bug — a bare `.set()` on mount is dropped before
framer-motion subscribes, and a reduced-motion user saw **"Rs. 0"** against a true balance of
Rs. 3,500 — which is why it routes through `animate(..., { duration: 0 })` instead.

**`StatCard.tsx` still does `count.set(value)`** with the same `useMotionValue(0)` starting point.
It may have the same latent bug. **I did not change it** — that would be a behaviour fix, not the
no-visual-change refactor you scoped. Flagging for Chunk 2 or its own item.

---

## Constraint compliance

| Constraint | Status |
|---|---|
| Presentation only; the four named files changed transition/variant props only | ✅ diffs above |
| `AnimatedMoney` mechanism preserved; settled amount identical | ✅ receipt and screen figures unchanged |
| No `lib/sales.ts`, `lib/receipt.ts`, `components/receipt/*`, `lib/format.ts`, `lib/receivables.ts`, API routes | ✅ none in the diff |
| No `Sale`/`SaleItem`, no Migration B, no receivables logic | ✅ untouched, still dormant |
| Live data unmodified | ✅ fingerprint matches; 2 real sales + Saif intact |
| No dependency installs/removals; stayed on framer-motion | ✅ `package.json` unchanged |
| Touch targets reported only, not fixed | ✅ #10 open |

**Stopping before Chunk 2**, as instructed.
