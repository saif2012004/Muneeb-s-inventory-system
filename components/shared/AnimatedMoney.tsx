"use client";

import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

import { formatPKR } from "@/lib/format";
import { moneyTransition, TWEEN } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A money figure that animates to its value.
 *
 * Two distinct jobs, chosen by `countUpOnMount`:
 *
 *   OFF (default) — a RUNNING TOTAL. The value keeps moving (a sale being
 *   typed), so it animates from wherever it currently is, on every change, and
 *   must never restart from zero. This is why the motion value initialises AT
 *   `value`: on first render there is nothing to count up from, only a figure to
 *   display.
 *
 *   ON — a SUMMARY TILE. The figure is fetched once and then sits there, so it
 *   counts up from 0 on mount. Without this the tile simply appears at its final
 *   value and the count-up the Design System asks for never happens — which is
 *   exactly what it did before this prop existed.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO TRANSITIONS
 * ---------------------------------------------------------------------------
 * The mount count-up uses `TWEEN.countUp` (0.7s easeOut), the same constant
 * StatCard uses — that is already the count-up feel in this app, and sharing it
 * keeps summary tiles consistent wherever they appear. `SPRING.money` is kept
 * for subsequent CHANGES, because a total that changes again mid-flight has to
 * redirect smoothly rather than restart, and only a spring carries its velocity
 * across. Tuned stiff and well damped so it settles in ~200ms and never
 * oscillates — on a money figure, wobble reads as an error, not as delight.
 *
 * Both live in `lib/motion.ts`; `moneyTransition()` picks between them.
 *
 * Running a 0.7s count-up on every change would make a live total feel sluggish;
 * running a 200ms spring from zero would flash rather than count. Hence both.
 *
 * The motion value stays a raw NUMBER and is formatted only on read, per the
 * Design System ("format after animating"). Animating a pre-formatted string
 * would interpolate the thousands separators and the "Rs.".
 */
export function AnimatedMoney({
  value,
  className,
  countUpOnMount = false,
}: {
  /** Already a number — never a raw Prisma Decimal (Gotcha 2). */
  value: number;
  className?: string;
  /**
   * Count up from 0 on first render. For summary tiles that are fetched once.
   * Leave off for a live running total, which must animate from its current
   * value rather than restarting.
   */
  countUpOnMount?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  // Starting at 0 is what makes the mount count-up possible at all. The initial
  // argument is only read on the first render, so later updates never reset it.
  const amount = useMotionValue(countUpOnMount ? 0 : value);
  const display = useTransform(amount, (latest) => formatPKR(latest));

  const hasAnimated = useRef(false);

  useEffect(() => {
    // Design System: never animate against a stated preference — a zero-length
    // transition makes the figure JUMP rather than travel.
    //
    // Deliberately `animate(..., { duration: 0 })` and NOT `amount.set(value)`.
    // With countUpOnMount the motion value starts at 0, and a bare `.set()` on
    // mount fires before framer-motion has subscribed the rendered child, so
    // the notification is dropped and the figure stays stuck at "Rs. 0" while
    // the sr-only text reads the real number. Verified: a reduced-motion user
    // saw Rs. 0 against a true balance of Rs. 3,500. Routing through animate()
    // uses the same path the count-up uses, which does propagate.
    if (reduceMotion) {
      hasAnimated.current = true;
      const controls = animate(amount, value, TWEEN.none);
      return () => controls.stop();
    }

    const isFirstRun = !hasAnimated.current;
    hasAnimated.current = true;

    // TWEEN.countUp on the first run, SPRING.money thereafter — see the block
    // comment above for why the two differ.
    const controls = animate(
      amount,
      value,
      moneyTransition(reduceMotion, isFirstRun && countUpOnMount)
    );
    return () => controls.stop();
  }, [amount, value, reduceMotion, countUpOnMount]);

  return (
    <span className={cn("num", className)}>
      {/* The animating figure is decorative; the exact value is what assistive
          tech reads, so it is never mid-flight or rounded oddly. */}
      <motion.span aria-hidden>{display}</motion.span>
      <span className="sr-only">{formatPKR(value)}</span>
    </span>
  );
}
