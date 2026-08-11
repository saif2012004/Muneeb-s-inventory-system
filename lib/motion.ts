/**
 * THE shared motion vocabulary. One place, so timings cannot drift.
 *
 * Before this file, every animated component hand-rolled its own transition at
 * the call site. That produced six spring configs and three durations across 13
 * components, several of them near-identical and clearly meant to be the same
 * thing (`420/34` alone appeared six times). Adding a fourteenth animated screen
 * meant inventing a seventh spring.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN SYSTEM RULES THIS ENCODES (CLAUDE.md → Design System → Motion)
 * ---------------------------------------------------------------------------
 *   - Purposeful, quick, spring-based. Nothing should feel slow.
 *   - Page/tab transitions: subtle fade + 8px slide, ~200ms.
 *   - Stat numbers: count up on mount; format AFTER animating.
 *   - Dialogs/sheets: spring scale/slide via AnimatePresence.
 *   - List rows: `layout` animation when items are added/removed.
 *   - ALWAYS respect `prefers-reduced-motion`.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THE NEAR-DUPLICATE SPRINGS ARE PRESERVED, NOT MERGED — READ THIS FIRST
 * ---------------------------------------------------------------------------
 * `lineItem` (480/38), `saleRow` (480/40) and `collapse` (400/40) are close
 * enough that merging them is tempting. They were deliberately left distinct
 * when this file was extracted, because that extraction was a pure refactor with
 * NO intended visual change, and collapsing them would have been one.
 *
 * Merging them is a real decision with a real (small) visual effect, so it wants
 * a browser check rather than a tidy-up. If you do merge them, do it as its own
 * change and look at the sale list and the new-sale form while you do.
 *
 * ---------------------------------------------------------------------------
 * HOW TO USE
 * ---------------------------------------------------------------------------
 *   const reduceMotion = useReducedMotion();
 *   <motion.div {...enterUp(reduceMotion)}>            // spreads initial/animate/transition
 *   <motion.div {...enterUp(reduceMotion, SPRING.snap)}>  // same shape, different feel
 *
 * The helpers take `reduceMotion` and handle it internally, so a component
 * cannot forget it — which was the other reason to centralise. `initial: false`
 * (not a zero-length transition) is what makes a reduced-motion element appear
 * already in place rather than travelling instantly.
 */
import type { Transition, TargetAndTransition } from "framer-motion";

/** `useReducedMotion()` returns `boolean | null` — null before it has resolved. */
type ReduceMotion = boolean | null;

// ---------------------------------------------------------------------------
// Durations — for the tween cases where a spring would be wrong
// ---------------------------------------------------------------------------

export const DURATION = {
  /** Inline feedback appearing in place — a form error under a field. */
  fast: 0.15,
  /** The Design System's "~200ms" page/tab transition. */
  page: 0.2,
  /**
   * Stat count-up. Long on purpose: this is the number travelling, and it is
   * the one animation in the app the owner is meant to watch rather than
   * absorb. Shared by StatCard and AnimatedMoney's mount count-up so summary
   * tiles feel the same wherever they appear.
   */
  countUp: 0.7,
} as const;

/** The standard easing for the tween cases above. */
export const EASE = "easeOut" as const;

export const TWEEN = {
  fast: { duration: DURATION.fast } satisfies Transition,
  page: { duration: DURATION.page, ease: EASE } satisfies Transition,
  countUp: { duration: DURATION.countUp, ease: EASE } satisfies Transition,
  /** A hard cut. Reduced motion, and the reset path in AnimatedMoney. */
  none: { duration: 0 } satisfies Transition,
} as const;

// ---------------------------------------------------------------------------
// Springs — the default, because the Design System asks for spring-based motion
// ---------------------------------------------------------------------------

export const SPRING = {
  /**
   * THE CANONICAL ONE. A page section or card arriving. Reach for this first —
   * it was already the most-used config in the app before this file existed.
   */
  section: { type: "spring", stiffness: 420, damping: 34 } satisfies Transition,

  /**
   * Snapping into place: the bottom-nav active indicator, and catalog rows
   * settling. Stiffer, so it reads as decisive rather than floaty.
   */
  snap: { type: "spring", stiffness: 500, damping: 40 } satisfies Transition,

  /** A sale line being added to or removed from the new-sale form. */
  lineItem: { type: "spring", stiffness: 480, damping: 38 } satisfies Transition,

  /** A sale row reflowing in the list (`layout="position"`). */
  saleRow: { type: "spring", stiffness: 480, damping: 40 } satisfies Transition,

  /** A height 0 ↔ auto disclosure, e.g. expanding a sale's line items. */
  collapse: { type: "spring", stiffness: 400, damping: 40 } satisfies Transition,

  /**
   * A money figure travelling to a NEW value (not the mount count-up).
   *
   * Stiff and well damped so it settles in ~200ms and never oscillates — on a
   * money figure, wobble reads as an error rather than as delight. `restDelta`
   * stops sub-rupee drift from keeping the spring alive after it has visually
   * arrived. Do not soften this one.
   */
  money: {
    type: "spring",
    stiffness: 380,
    damping: 40,
    restDelta: 0.5,
  } satisfies Transition,
} as const;

// ---------------------------------------------------------------------------
// Variants — the shapes, already reduced-motion aware
// ---------------------------------------------------------------------------

/** What a `motion` element needs for a one-shot entrance. */
type EnterProps = {
  initial: false | TargetAndTransition;
  animate: TargetAndTransition;
  transition: Transition;
};

/**
 * The house entrance: fade + 8px rise. The Design System's "subtle fade + 8px
 * slide", and the shape most screens already used.
 */
export function enterUp(
  reduceMotion: ReduceMotion,
  transition: Transition = SPRING.section
): EnterProps {
  return {
    initial: reduceMotion ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition,
  };
}

/** Entrance from the left, for the desktop sidebar sliding in. */
export function enterLeft(
  reduceMotion: ReduceMotion,
  transition: Transition = TWEEN.page
): EnterProps {
  return {
    initial: reduceMotion ? false : { x: -12, opacity: 0 },
    animate: { x: 0, opacity: 1 },
    transition,
  };
}

/**
 * A table/list row appearing and leaving. Smaller travel than `enterUp` because
 * a row moves within a dense grid, and 8px there reads as the whole table
 * shifting.
 */
export function rowInOut(
  reduceMotion: ReduceMotion,
  transition: Transition = SPRING.snap
) {
  return {
    initial: reduceMotion ? false : { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 },
    transition,
  };
}

/**
 * A sale line entering/leaving the new-sale form.
 *
 * Asymmetric on purpose: it enters with a plain rise, and EXITS with a slight
 * scale-down so a removed line reads as being taken away rather than merely
 * fading. That asymmetry is the existing behaviour and is preserved verbatim —
 * do not "balance" it by adding a scale to `initial`.
 */
export function lineItemInOut(
  reduceMotion: ReduceMotion,
  transition: Transition = SPRING.lineItem
) {
  return {
    initial: reduceMotion ? false : { opacity: 0, y: -8 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 },
    transition,
  };
}

/** A height 0 ↔ auto disclosure. Pair with `className="overflow-hidden"`. */
export function collapseInOut(
  reduceMotion: ReduceMotion,
  transition: Transition = SPRING.collapse
) {
  return {
    initial: reduceMotion ? false : { height: 0, opacity: 0 },
    animate: { height: "auto" as const, opacity: 1 },
    exit: reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 },
    transition,
  };
}

/** Inline feedback — a form error appearing under its field. */
export function feedbackIn(reduceMotion: ReduceMotion): EnterProps {
  return {
    initial: reduceMotion ? false : { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0 },
    transition: TWEEN.fast,
  };
}

/**
 * The transition for a `layoutId` indicator (the bottom-nav pill). Reduced
 * motion gets a hard cut: the indicator must still MOVE, it just must not
 * travel.
 */
export function indicatorTransition(reduceMotion: ReduceMotion): Transition {
  return reduceMotion ? TWEEN.none : SPRING.snap;
}

/**
 * The transition for a number counting to a value.
 *
 * `firstCountUp` is the mount count-up (a summary tile fetched once); anything
 * else is a running total redirecting mid-flight, which needs a spring to carry
 * its velocity rather than restarting. See AnimatedMoney for why both exist.
 */
export function moneyTransition(
  reduceMotion: ReduceMotion,
  firstCountUp: boolean
): Transition {
  if (reduceMotion) return TWEEN.none;
  return firstCountUp ? TWEEN.countUp : SPRING.money;
}
