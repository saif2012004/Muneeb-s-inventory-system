# Response — count-up on mount, and the Phase 8 touch-target log

**Date:** 7 Aug 2026
**Task:** add an opt-in `countUpOnMount` to AnimatedMoney and enable it on the hub tile; log the
touch-target finding as a Phase 8 item; skip the serverless SSO proof.
**Outcome:** both done, browser-verified. Committed **`9ff4396`**, pushed.
**One regression found mid-change and fixed — details in §2, because it was mine.**

---

## 1. The fix — opt-in, as asked

`components/shared/AnimatedMoney.tsx` gains `countUpOnMount?: boolean` (default **false**), and
the hub's total-outstanding tile turns it on. Nothing else changed call-site behaviour.

Why the prop rather than a change: the component initialised its motion value **at** the target,
which is *correct* for its original job — the new-sale running total, which must animate from
wherever it currently is and never restart from zero. Making it count up unconditionally would
have broken that. Opt-in keeps both behaviours honest.

### Two transitions, deliberately

| Situation | Transition | Why |
|---|---|---|
| Mount, `countUpOnMount` on | **0.7s easeOut** | Matches `StatCard`, already the count-up feel in this app — summary tiles stay consistent wherever they appear |
| Any subsequent change | **spring** (380/40) | A total that moves again mid-flight must redirect smoothly; only a spring carries velocity across |

A 0.7s tween on every change would make a live total feel sluggish; a 200 ms spring from zero
would flash rather than count. Hence both.

---

## 2. A regression I introduced, and fixed

Worth stating plainly rather than burying: **the first version of this change broke
reduced-motion**, and the browser caught it.

Under `prefers-reduced-motion`, the tile displayed **Rs. 0** while the screen-reader text
correctly read **Rs. 3,500**:

```json
{ "reduceMotion": true,
  "animatedSpanText": "Rs. 0",
  "screenReaderText": "Rs. 3,500",
  "mismatch": true }
```

**A wrong number on screen — worse than no animation at all.**

**Cause.** Previously the motion value started *at* `value`, so the reduced-motion path's
`amount.set(value)` was a no-op and never actually had to propagate anything. Starting at 0 meant
`.set()` finally had to do real work — and on mount it fires *before* framer-motion has subscribed
the rendered child, so the notification was dropped and the span kept showing its first render.

**Fix.** The reduced-motion path now uses `animate(amount, value, { duration: 0 })` — the same
mechanism the count-up uses, which demonstrably propagates. Still a jump, no animation, but the
figure is right. Documented in the source so it isn't "simplified" back to `.set()`.

This is exactly the class of bug that a green build hides: `tsc` and `next lint` were clean the
whole time.

---

## 3. Browser verification — all three paths

### Motion allowed — counts up

```
36 distinct frames · started at Rs. 0 · monotonic · 637 ms
Rs. 0 → 1,722 → 3,031 → 3,393 → 3,477 → 3,495 → Rs. 3,500
```

Decelerating intervals — the easeOut signature — and 637 ms against the intended 0.7 s.

### Reduced motion — jumps, and is correct

```json
{ "distinctFrames": 2, "frames": ["Rs. 0", "Rs. 3,500"],
  "visibleText": "Rs. 3,500", "screenReaderText": "Rs. 3,500",
  "visibleMatchesTruth": true }
```

Two frames, i.e. a jump, and the visible figure now agrees with the truth. **Not regressed.**

### Running total (prop off) — unchanged

Changed a line price on `/beverages/new-sale` and watched the pinned total:

```
Rs. 1,000 → 1,155 → 1,494 → 1,808 → 1,940 → 2,143 → 2,275 → 2,360 → Rs. 2,500
```

Travels **from its current value**, never restarts at 0. The original behaviour is intact.

*Method note:* the first two attempts captured 0 and 1 frames because the recorder started after
the animation had already finished — the balance query takes ~5 s in dev. Installing the rAF
recorder via `initScript`, before any app code runs, is what made the frames visible. Mentioning
it because "1 frame" initially looked like a failure and was measurement error, not behaviour.

---

## 4. Phase 8 touch-target item logged

Added to CLAUDE.md's carried-forward notes, **not fixed**:

> **Phase 8 (touch targets) — QUEUED, found in 4b:** shadcn `TabsTrigger` is **28px** and the
> "All customers" back link is **20px**, against the Design System's 44px minimum. These are
> framework/text defaults rather than one-off mistakes, so the same undersized tabs will exist
> wherever they're used — Phase 5's milk tabs will inherit it too. **Do NOT patch piecemeal.**
> Raise app-wide in the a11y sweep, ideally by overriding the `TabsTrigger` default once in
> `components/ui/tabs.tsx`. Everything else measured clean: inputs, buttons and cards are ≥44px.

The note carries the measurements and the recommended single point of change, so the Phase 8 pass
doesn't have to rediscover either.

---

## 5. Serverless SSO proof — skipped, as directed

Noted and not pursued. Agreed on the reasoning: the fix removes concurrency rather than tuning a
limit, so it's runtime-independent, and it was reproduced against the same pooled connection in
dev.

---

## 6. State

- Commit **`9ff4396`** — *fix: count-up on mount for summary tiles* — 3 files, +82/−22. Pushed
  (`719e04b..9ff4396`).
- `tsc --noEmit` clean · `next lint` clean.
- DB at **exact baseline**: 1 user (`i228767@nu.edu.pk`), 0 customers, 0 payments, 0 sales in any
  module, 62 products all active at price 0, 2 categories / 11 sub-categories. All `ZZ_TEST_` data
  removed after confirming 0 non-test rows were in range.
- Owner account untouched; isolated browser context; dev server stopped.
- No deploy this round — the change is client-only and the last preview (`8448591`) already built
  green. Say the word if you'd like one before Phase 5.

| Phase | Status |
|---|---|
| 1–4, 4b | ✅ Done |
| **5** | ⬜ **Next — milk shop: farmers, deliveries, purchases, quick-entry, milk sales** |
| 6–8 | ⬜ |

Two things already waiting for Phase 5, both recorded in CLAUDE.md: **`MilkSale` is already
counted** in the receivables calculation, so milk sales will land in customer balances with no
change there; and the **milk module's summary tiles can use `countUpOnMount`** directly.

Stopped.
