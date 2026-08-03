"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

import { formatPKR } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A money figure that springs to its new value whenever it changes.
 *
 * Differs from StatCard's count-up in the one way that matters here: StatCard
 * animates ONCE on mount, from zero. This tracks a value that keeps moving —
 * the running total of a sale being typed — so it must animate from wherever it
 * currently is, on every change, without ever restarting from zero.
 *
 * A spring, not a duration tween: a total that changes again mid-flight has to
 * redirect smoothly rather than restart, and only a spring carries its velocity
 * across. Tuned stiff and well damped so it settles in ~200ms and never
 * oscillates — on a running total, wobble reads as an error, not as delight.
 *
 * The motion value stays a raw NUMBER and is formatted only on read, per the
 * Design System ("format after animating"). Animating a pre-formatted string
 * would interpolate the thousands separators and the "Rs.".
 */
export function AnimatedMoney({
  value,
  className,
}: {
  /** Already a number — never a raw Prisma Decimal (Gotcha 2). */
  value: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  const amount = useMotionValue(value);
  const display = useTransform(amount, (latest) => formatPKR(latest));

  useEffect(() => {
    if (reduceMotion) {
      amount.set(value);
      return;
    }
    const controls = animate(amount, value, {
      type: "spring",
      stiffness: 380,
      damping: 40,
      // Stop sub-rupee drift from keeping the spring alive after it has
      // visually arrived.
      restDelta: 0.5,
    });
    return () => controls.stop();
  }, [amount, value, reduceMotion]);

  return (
    <span className={cn("num", className)}>
      {/* The animating figure is decorative; the exact value is what assistive
          tech reads, so it is never mid-flight or rounded oddly. */}
      <motion.span aria-hidden>{display}</motion.span>
      <span className="sr-only">{formatPKR(value)}</span>
    </span>
  );
}
