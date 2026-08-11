"use client";

import { useEffect, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatLiters, formatPKR } from "@/lib/format";
import { TWEEN } from "@/lib/motion";
import { ACCENTS, type AccentKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

export type StatCardProps = {
  label: string;
  /** Already serialized to a number — never a raw Prisma Decimal. */
  value: number;
  /**
   * A rendered element, e.g. `<GlassWater />` — NOT the component itself.
   * This is a client component, and a server page cannot pass a function
   * across the boundary. StatCard sizes the svg, so callers pass it bare.
   */
  icon: ReactNode;
  accent?: AccentKey;
  format?: "money" | "liters" | "number";
  /** Percent change vs. the previous period. Positive renders emerald. */
  trend?: { value: number; label?: string };
  className?: string;
};

const NUMBER = new Intl.NumberFormat("en-US");

function formatValue(value: number, format: NonNullable<StatCardProps["format"]>) {
  if (format === "money") return formatPKR(value);
  if (format === "liters") return formatLiters(value);
  return NUMBER.format(Math.round(value));
}

export function StatCard({
  label,
  value,
  icon,
  accent = "zinc",
  format = "money",
  trend,
  className,
}: StatCardProps) {
  const reduceMotion = useReducedMotion();
  const tone = ACCENTS[accent];

  // Count-up on mount. The motion value stays a raw number and is formatted
  // only on read, per the Design System ("format after animating") — animating
  // a pre-formatted string would interpolate the commas and the "Rs.".
  const count = useMotionValue(0);
  const display = useTransform(count, (latest) => formatValue(latest, format));

  useEffect(() => {
    /**
     * Deliberately `animate(..., TWEEN.none)` and NOT `count.set(value)` —
     * the same mechanism, and the same reason, as AnimatedMoney.
     *
     * The motion value starts at 0, and a bare `.set()` on mount fires before
     * framer-motion has subscribed the rendered child, so the notification is
     * dropped and the tile stays stuck at "Rs. 0" while the sr-only text reads
     * the real number. `DashboardHome` renders a Skeleton until its summary
     * loads and only THEN mounts this card, so the very first `.set()` is the
     * one carrying the real figure — precisely the one that got lost.
     *
     * Reproduced 2026-08-11 with reduced motion on: "Total today" and
     * "Beverages" both displayed Rs. 0 against a true Rs. 3,500. Routing
     * through animate() uses the same path the count-up uses, which does
     * propagate. `TWEEN.none` is a zero-length transition, so the figure still
     * appears instantly — no animation against a stated preference.
     */
    const controls = animate(
      count,
      value,
      reduceMotion ? TWEEN.none : TWEEN.countUp
    );
    return () => controls.stop();
  }, [count, value, reduceMotion]);

  const trendUp = (trend?.value ?? 0) >= 0;
  const TrendIcon = trendUp ? TrendingUp : TrendingDown;

  return (
    <Card className={cn("rounded-xl shadow-sm", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            {label}
          </p>
          <span
            aria-hidden
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-[18px]",
              tone.icon
            )}
          >
            {icon}
          </span>
        </div>

        <p className={cn("num mt-3 text-[28px] font-bold leading-tight", tone.text)}>
          {/* The live formatted value; the static child is what SSR and
              screen readers see before hydration. */}
          <motion.span aria-hidden>{display}</motion.span>
          <span className="sr-only">{formatValue(value, format)}</span>
        </p>

        {trend ? (
          <p
            className={cn(
              "mt-2 flex items-center gap-1 text-[13px]",
              trendUp ? "text-emerald-600" : "text-rose-600"
            )}
          >
            <TrendIcon className="size-3.5" aria-hidden />
            <span className="num font-medium">
              {trendUp ? "+" : ""}
              {trend.value}%
            </span>
            {trend.label ? (
              <span className="text-zinc-500">{trend.label}</span>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
