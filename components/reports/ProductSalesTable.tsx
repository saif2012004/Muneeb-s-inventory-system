"use client";

import { RefreshCw } from "lucide-react";

import { ExportCsvButton } from "@/components/shared/ExportCsvButton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPKR } from "@/lib/format";
import { useProductSales, type ProductSalesRow } from "@/lib/hooks/use-reports";
import type { ReportPeriod } from "@/lib/reports-display";
import { cn } from "@/lib/utils";

/**
 * PER-PRODUCT SALES (#20) — "how much of each product did I sell", not just how
 * much each shop took.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A TABLE AND NOT A CHART
 * ---------------------------------------------------------------------------
 * The two charts above answer "what sells best" — a top five, ranked, at a
 * glance. This answers a different question the owner asked outright: how many
 * eggs, how many buns, how many litres. That is a figure to READ and compare
 * against what he counted on the shelf, so it is a table with tabular-nums, in
 * revenue order, with no truncation to a top N.
 *
 * MILK IS ITS OWN ROW, which is the part that could not exist before: rows carry
 * the snapshotted `moduleKey`, so milk is not folded into whatever category its
 * product happens to sit under, and recategorising a product later cannot move
 * last month's sales between shops.
 */

const MODULE_BADGE: Record<string, { class: string; label: string }> = {
  beverages: { class: "bg-blue-50 text-blue-700", label: "Beverages" },
  bakery: { class: "bg-amber-50 text-amber-700", label: "Bakery" },
  milk: { class: "bg-emerald-50 text-emerald-700", label: "Milk" },
};

/** `12.5 litres`, `3 cottons`, or a bare `12` when the unit adds nothing. */
function formatQuantity(row: ProductSalesRow): string {
  const quantity = String(row.quantity);
  if (!row.unit || row.unit === "piece" || row.unit === "bottle") return quantity;
  return `${quantity} ${row.unit}${row.quantity === 1 ? "" : "s"}`;
}

export function ProductSalesTable({ period }: { period: ReportPeriod }) {
  const query = useProductSales(period);
  const rows = query.data ?? [];

  return (
    <section className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Sales by product</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Every product sold in this period, across all three shops.
          </p>
        </div>
        {/* The same figures as a file. Not period-filtered on purpose — the
            export takes its own date range, and the owner usually wants the lot
            when they reach for a spreadsheet. */}
        <ExportCsvButton type="product_sales" label="Export" />
      </div>

      {query.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 py-2">
          <p className="text-sm text-zinc-500">Couldn&apos;t load product sales.</p>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-lg"
            onClick={() => query.refetch()}
          >
            <RefreshCw className="mr-2 size-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">
          Nothing sold in this period yet.
        </p>
      ) : (
        // Scrolls inside its own box on a phone rather than pushing the page
        // sideways — money that scrolls off screen is money that can't be checked.
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse">
            <thead>
              <tr className="border-b border-zinc-100 text-left">
                <th className="px-1 pb-2 text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                  Product
                </th>
                <th className="px-1 pb-2 text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                  Shop
                </th>
                <th className="px-1 pb-2 text-right text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                  Sold
                </th>
                <th className="px-1 pb-2 text-right text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const badge = MODULE_BADGE[row.moduleKey];
                return (
                  <tr
                    key={`${row.productId}-${row.moduleKey}`}
                    className="border-b border-zinc-50 last:border-0"
                  >
                    <td className="px-1 py-2.5 text-sm font-medium text-zinc-900">
                      {row.productName}
                    </td>
                    <td className="px-1 py-2.5">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-xs font-medium",
                          badge?.class ?? "bg-zinc-100 text-zinc-600"
                        )}
                      >
                        {badge?.label ?? row.moduleKey}
                      </span>
                    </td>
                    <td className="num px-1 py-2.5 text-right text-sm text-zinc-600">
                      {formatQuantity(row)}
                    </td>
                    <td className="num px-1 py-2.5 text-right text-sm font-semibold text-zinc-900">
                      {formatPKR(row.revenue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
