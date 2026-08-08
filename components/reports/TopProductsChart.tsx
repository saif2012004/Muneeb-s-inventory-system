"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import { formatPKR } from "@/lib/format";
import type { TopProduct } from "@/lib/hooks/use-reports";

/**
 * Top products by revenue, as a horizontal bar chart.
 *
 * Horizontal on purpose: product names here are things like
 * "Pepsi 1.5L (30% off)" and "Russ Large Rectangular Round". On a vertical
 * chart at 360px those labels either overlap or get truncated to uselessness;
 * along the Y axis they have room to read.
 *
 * A bar chart earns its place here where it didn't on the Phase 6 balance
 * sheet: the question is "which of these is biggest", relative length answers
 * it instantly, and the exact figure is still in the tooltip and the label.
 */
export function TopProductsChart({
  products,
  colour,
  isLoading,
  isError,
  onRetry,
  emptyMessage,
}: {
  products: TopProduct[];
  colour: string;
  isLoading: boolean;
  /** Distinguished from "empty" — a failed request is not "nothing sold". */
  isError?: boolean;
  onRetry?: () => void;
  emptyMessage: string;
}) {
  if (isLoading) {
    return <Skeleton className="h-[200px] w-full rounded-lg" />;
  }

  if (isError) {
    return (
      <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-200 px-4 text-center text-sm text-zinc-500">
        <span>Couldn&apos;t load this list.</span>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[44px] font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900"
        >
          Try again
        </button>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-zinc-200 px-4 text-center text-sm text-zinc-500">
        {emptyMessage}
      </div>
    );
  }

  // Recharts draws the first datum at the bottom of a horizontal chart, so the
  // biggest seller would end up at the bottom unless the order is flipped.
  const data = [...products].reverse();

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 12, fill: "#71717a" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) =>
            value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
          }
        />
        <YAxis
          type="category"
          dataKey="productName"
          tick={{ fontSize: 12, fill: "#3f3f46" }}
          tickLine={false}
          axisLine={false}
          width={116}
        />
        <Tooltip
          // Widened for Recharts 3's `ValueType | undefined`, then narrowed.
          formatter={(value, _name, item) => {
            const revenue = typeof value === "number" ? value : 0;
            const sold = (item?.payload as TopProduct | undefined)?.quantity ?? 0;
            return [`${formatPKR(revenue)} · ${sold} sold`, "Revenue"];
          }}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #e4e4e7",
            fontSize: 13,
          }}
          cursor={{ fill: "#fafafa" }}
        />
        <Bar dataKey="revenue" radius={[0, 6, 6, 0]} barSize={18}>
          {data.map((product) => (
            <Cell key={product.productId} fill={colour} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
