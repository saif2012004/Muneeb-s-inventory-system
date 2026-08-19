# StatCard reduced-motion check — bug was REAL, reproduced and fixed

**Date:** 2026-08-11
**Commit:** `beb8de7` — pushed to `main`
**Scope:** `components/shared/StatCard.tsx` only. Nothing else touched.

---

## STEP 1 — Verification

### Tree state, quoted

```
$ git log --oneline -1
60437a5 refactor: extract shared motion vocabulary (lib/motion.ts); adopt in 13 components

$ git status --porcelain
?? docs/responses/2026-08-11-chunk-1-motion-vocabulary.md
```

**HEAD = `60437a5`** ✅. Zero tracked modifications, zero deletions; the one untracked file is last
turn's response doc.

### The relevant StatCard.tsx lines, verbatim (as they were before the fix)

**The motion value init and its transform — lines 56–60:**

```tsx
  // Count-up on mount. The motion value stays a raw number and is formatted
  // only on read, per the Design System ("format after animating") — animating
  // a pre-formatted string would interpolate the commas and the "Rs.".
  const count = useMotionValue(0);
  const display = useTransform(count, (latest) => formatValue(latest, format));
```

**The effect, with its reduced-motion branch — lines 62–69:**

```tsx
  useEffect(() => {
    if (reduceMotion) {
      count.set(value);
      return;
    }
    const controls = animate(count, value, TWEEN.countUp);
    return () => controls.stop();
  }, [count, value, reduceMotion]);
```

**What is rendered — lines 92–97:**

```tsx
        <p className={cn("num mt-3 text-[28px] font-bold leading-tight", tone.text)}>
          {/* The live formatted value; the static child is what SSR and
              screen readers see before hydration. */}
          <motion.span aria-hidden>{display}</motion.span>
          <span className="sr-only">{formatValue(value, format)}</span>
        </p>
```

### The verdict: **the bug is REAL. The displayed value can stick at 0.**

Reasoning from the code: `count` starts at **0**. Under reduced motion the effect calls
`count.set(value)` — a bare set, not routed through `animate()`. The visible figure is
`<motion.span>{display}</motion.span>`, a MotionValue-driven child whose DOM text is updated by
framer-motion's subscription. If that subscription is not yet live when `.set()` fires, the
notification is dropped and the span keeps rendering the initial `0`. The `sr-only` sibling is plain
React and always shows the truth, so the two disagree — which is exactly the signature to look for.

**`DashboardHome` turns this from an edge case into the normal case.** It returns a Skeleton block
while loading and mounts `<StatCard>` only once `summary` exists:

```tsx
    return (
      <>
        {header}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Total today" value={summary.combined.totalRevenue} … />
```

So the card's **first** `.set()` is the one carrying the real figure — precisely the one that gets
lost.

### Reproduced in the browser, not inferred

I did not stop at reasoning. A `ZZ_TEST_` beverage sale of **Rs. 3,500 dated today** was created so
the dashboard's "today" tiles were nonzero, then the dashboard was loaded with `matchMedia`
reporting reduced motion:

| Tile | Displayed (`motion.span`) | Truth (`sr-only`) | |
|---|---|---|---|
| **Total today** | **`Rs. 0`** | **`Rs. 3,500`** | ❌ **MISMATCH** |
| **Beverages** | **`Rs. 0`** | **`Rs. 3,500`** | ❌ **MISMATCH** |
| Bakery | `Rs. 0` | `Rs. 0` | ✓ genuinely zero |
| Milk sold | `Rs. 0` | `Rs. 0` | ✓ genuinely zero |

Read 3+ seconds after mount — far past any 0.7s count-up. **A reduced-motion owner saw Rs. 0 for a
day on which Rs. 3,500 had been taken.** Same failure, same figure, as the one AnimatedMoney's
docblock records.

> **A false start worth reporting.** My first attempt tested `/reports`, where all five tiles matched
> and I nearly concluded "no bug". That page defines its **own local `StatCard`** at
> `ReportsDashboard.tsx:450`, which renders `<AnimatedMoney countUpOnMount />` — so I had verified
> AnimatedMoney's *existing fix*, not the shared component. The prop shape gave it away
> (`loading`, `tone`, `border`, `hint`, `countUp` are not shared-StatCard props). Worth knowing:
> **there are two different StatCards in this codebase**, and only `components/shared/StatCard.tsx`
> is the one under discussion.

---

## STEP 2 — The fix

Only the effect changed:

```diff
   useEffect(() => {
-    if (reduceMotion) {
-      count.set(value);
-      return;
-    }
-    const controls = animate(count, value, TWEEN.countUp);
+    /**
+     * Deliberately `animate(..., TWEEN.none)` and NOT `count.set(value)` —
+     * the same mechanism, and the same reason, as AnimatedMoney.
+     * … (full reasoning, and the reproduction, in the comment)
+     */
+    const controls = animate(
+      count,
+      value,
+      reduceMotion ? TWEEN.none : TWEEN.countUp
+    );
     return () => controls.stop();
   }, [count, value, reduceMotion]);
```

`TWEEN.none` **is** `{ duration: 0 }`, so the figure still appears instantly — nothing animates
against a stated preference. The cleanup now also covers the reduced-motion path, which the early
`return` previously skipped.

`useMotionValue(0)`, `useTransform`, the render tree, the props and the non-reduced-motion
`TWEEN.countUp` are all untouched.

---

## Verification

### Reduced motion ON — the fix works

Same fixture (Rs. 3,500 today), same emulation, re-loaded after the change:

| Tile | Displayed | Truth | |
|---|---|---|---|
| Total today | **`Rs. 3,500`** | `Rs. 3,500` | ✅ |
| Beverages | **`Rs. 3,500`** | `Rs. 3,500` | ✅ |
| Bakery | `Rs. 0` | `Rs. 0` | ✅ |
| Milk sold | `Rs. 0` | `Rs. 0` | ✅ |

**How I confirmed it:** for each tile I read the `motion.span[aria-hidden]` text (what the eye sees)
and its `span.sr-only` sibling (the value passed in, formatted directly by React with no motion
involved) and compared them. The sr-only span is an independent source of truth — it never routes
through a MotionValue — so agreement between the two is proof the displayed figure is the real one.
Before: 2 of 4 mismatched. After: 4 of 4 match.

### Reduced motion OFF — count-up identical

Sampled the displayed text every animation frame on a normal load:

```
44 distinct intermediate values
Rs. 0 → Rs. 109 → Rs. 216 → Rs. 351 → … → Rs. 3,492 → Rs. 3,499 → Rs. 3,500
settled: displayed "Rs. 3,500" == truth "Rs. 3,500"
```

Still `TWEEN.countUp` (0.7s easeOut), still counting from 0 through a smooth ramp. **No visual
change to the normal path.**

### Build

```
tsc --noEmit (NODE_OPTIONS=--max-old-space-size=4096)   exit 0
next lint                                               clean
npm run build                                           green
```

*(The build first failed with `EPERM … query_engine-windows.dll.node` — `prisma generate` cannot
replace the engine while a dev server holds it open. Stopped the server, rebuilt, green. Operational,
not a code issue; worth knowing since it looks alarming.)*

---

## Housekeeping

- **Only `components/shared/StatCard.tsx` modified** — `git status` confirmed a single tracked file
  in the diff.
- No money-logic files, no `Sale`/`SaleItem`, no Migration B, no receivables.
- **`ZZ_TEST_` data removed** — the test user, customer, sale and line item. Product stock restored
  to 100.
- **Real data untouched:** 27 products with fingerprint `95794a0bb44f1b15d541a60ef0bd5c51` (matches
  the pre-test baseline), customer `Saif`, bakery Rs. 5,000, milk Rs. 6,000, one owner account.

**HEAD:** `beb8de7`, pushed.

```
beb8de7  fix: StatCard reduced-motion money display (avoid dropped .set on mount)
60437a5  refactor: extract shared motion vocabulary (lib/motion.ts); adopt in 13 components
caa1d78  docs: track session response docs; correct #10 touch-target measurement
```

---

## One observation for later, no action taken

The two-StatCard situation is a small structural wart: `components/shared/StatCard.tsx` and the
private one at `ReportsDashboard.tsx:450` are different components with the same name and
overlapping jobs, and the reports one delegates its money display to `AnimatedMoney` while the
shared one re-implements the count-up itself. That duplication is what let this bug survive in one
copy after being fixed in the other — and it is what nearly made me miss it just now.

Consolidating them would be a Chunk 2-shaped change with a visual check, not something to fold into
a behaviour fix. Flagging it, not doing it.
