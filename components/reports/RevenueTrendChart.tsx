"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatPKR } from "@/lib/format";
import type { TrendPoint } from "@/lib/hooks/use-reports";
import type { TrendGrouping } from "@/lib/reports";

/**
 * Revenue over time, one line per sales module.
 *
 * THIS CHART EARNS ITS PLACE. Phase 6 declined a chart because a bar per farmer
 * was strictly less informative than the sorted table beside it. A trend is
 * different: the shape over time — which module is climbing, where a week
 * collapsed — is genuinely not visible in any table on this screen.
 *
 * Module colours are the Design System accents (beverages blue, bakery amber,
 * milk emerald). This is the one screen that mixes accents on purpose: here the
 * colour identifies a data series, so using anything else would be less
 * meaningful, not more consistent.
 */

const SERIES = [
  { key: "beverages", label: "Beverages", colour: "#2563eb" },
  { key: "bakery", label: "Bakery", colour: "#d97706" },
  { key: "milk", label: "Milk", colour: "#059669" },
] as const;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * `YYYY-MM-DD` -> a short axis label.
 *
 * Parsed by splitting the string, NOT via `new Date(period)`. The bucket is
 * already a Karachi calendar day; feeding it to the Date constructor would
 * parse it as UTC midnight and then render it in the browser's local zone,
 * which can shift the label by a day — the exact bug the server-side bucketing
 * was written to avoid, reintroduced at the last step.
 */
function axisLabel(period: string, groupBy: TrendGrouping): string {
  const [year, month, day] = period.split("-");
  if (groupBy === "month") return `${MONTHS[Number(month) - 1]} ${year.slice(2)}`;
  return `${day}/${month}`;
}

type Row = { period: string; label: string } & Record<string, number | string>;

export function RevenueTrendChart({
  beverages,
  bakery,
  milk,
  groupBy,
  height = 280,
}: {
  beverages: TrendPoint[];
  bakery: TrendPoint[];
  milk: TrendPoint[];
  groupBy: TrendGrouping;
  height?: number;
}) {
  /**
   * Merge the three series onto a shared period axis.
   *
   * Each module only returns buckets it actually has sales in, so a day where
   * only bakery sold would otherwise be missing from the other two series and
   * the lines would be drawn against different x positions. Taking the UNION of
   * the periods and defaulting the rest to 0 is what keeps them comparable —
   * and 0 is the truth here: no sale means no revenue.
   */
  const data = useMemo<Row[]>(() => {
    const byPeriod = new Map<string, Row>();

    const add = (points: TrendPoint[], key: string) => {
      for (const point of points) {
        let row = byPeriod.get(point.period);
        if (!row) {
          row = {
            period: point.period,
            label: axisLabel(point.period, groupBy),
            beverages: 0,
            bakery: 0,
            milk: 0,
          };
          byPeriod.set(point.period, row);
        }
        row[key] = point.revenue;
      }
    };

    add(beverages, "beverages");
    add(bakery, "bakery");
    add(milk, "milk");

    // Lexicographic sort is chronological for YYYY-MM-DD.
    return Array.from(byPeriod.values()).sort((a, b) =>
      a.period.localeCompare(b.period)
    );
  }, [beverages, bakery, milk, groupBy]);

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-200 text-sm text-zinc-500">
        No sales in this period yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: "#71717a" }}
          tickLine={false}
          axisLine={{ stroke: "#e4e4e7" }}
          minTickGap={16}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#71717a" }}
          tickLine={false}
          axisLine={false}
          width={64}
          // Compact so a 5-figure axis doesn't eat the plot area on a phone.
          tickFormatter={(value: number) =>
            value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
          }
        />
        <Tooltip
          // Recharts 3 types the formatter value as `ValueType | undefined`, so
          // it is widened here and narrowed rather than asserted.
          formatter={(value, name) => [
            formatPKR(typeof value === "number" ? value : 0),
            String(name ?? ""),
          ]}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #e4e4e7",
            fontSize: 13,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 13 }} />
        {SERIES.map((series) => (
          <Line
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stroke={series.colour}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
