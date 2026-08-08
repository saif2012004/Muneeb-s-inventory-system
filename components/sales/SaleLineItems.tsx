"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSize, titleCase } from "@/lib/catalog-display";
import { formatPKR } from "@/lib/format";
import { useSale } from "@/lib/hooks/use-sales";
import { formatQuantityWithUnit } from "@/lib/sale-catalog";
import type { SaleModule } from "@/lib/sale-modules";

/**
 * The line items shown inside an expanded sale row, fetched on demand.
 *
 * Every figure here is the line's OWN stored snapshot — `unitPrice` and
 * `lineTotal` as they were when the sale was written. The product is joined for
 * its name only; today's catalog price is never shown against a past sale
 * (Gotcha 5).
 */
export function SaleLineItems({
  module,
  saleId,
}: {
  module: SaleModule;
  saleId: string;
}) {
  const saleQuery = useSale(module, saleId);

  if (saleQuery.isPending) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1].map((row) => (
          <Skeleton key={row} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (saleQuery.error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-zinc-500">Couldn&apos;t load the items.</p>
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-lg"
          onClick={() => saleQuery.refetch()}
        >
          <RefreshCw className="mr-2 size-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  // `7.50` reads as a typo on a bill; `7.5` and `7` read as percentages. The
  // column is DECIMAL(5,2), so trailing zeros arrive from the server.
  function trimPercent(value: number): string {
    return String(Number(value));
  }

  const sale = saleQuery.data;
  if (!sale) return null;

  // Derived for DISPLAY only — the stored `totalAmount` is the authority. This
  // is the gap between the lines and the bottom line, which is exactly what the
  // whole-bill discount took off.
  const subtotal = sale.items.reduce((sum, item) => sum + item.lineTotal, 0);
  const billSaving = subtotal - sale.totalAmount;

  return (
    <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/60 p-4">
      {sale.items.map((item) => {
        // Same attributes the picker shows, so a line reads the way it was
        // chosen — without these, all four Russ variants look identical here.
        const detail = [
          formatSize(item.product.size) !== "—" ? formatSize(item.product.size) : null,
          item.product.qualityTier ? titleCase(item.product.qualityTier) : null,
          item.product.shape ? titleCase(item.product.shape) : null,
          // The discount stored ON THE LINE, not `product.discountPercent`.
          // That distinction is the whole point of the rework: the product no
          // longer carries a discount, and an old bill must keep showing the
          // deal that was actually struck even after the owner's usual rate
          // changes. Reading it off the product would make history mutable.
          Number(item.discountPercent) > 0
            ? `${trimPercent(item.discountPercent)}% off`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <div
            key={item.id}
            className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900">
                {item.product.name}
                {!item.product.isActive ? (
                  <span className="ml-2 text-xs font-normal text-zinc-400">
                    (inactive)
                  </span>
                ) : null}
              </p>
              <p className="num mt-0.5 text-xs text-zinc-500">
                {detail ? `${detail} · ` : ""}
                {formatQuantityWithUnit(item.quantity, item.product.unit)} ×{" "}
                {formatPKR(item.unitPrice)}
              </p>
            </div>
            <span className="num shrink-0 text-sm font-semibold text-zinc-900">
              {formatPKR(item.lineTotal)}
            </span>
          </div>
        );
      })}

      {/* The whole-bill discount, if one was given. Shown as its own row rather
          than folded into the total, so the bill explains itself: the lines sum
          to the subtotal, and this is what came off the bottom. */}
      {Number(sale.discountPercent) > 0 ? (
        <div className="flex items-baseline justify-between gap-3 rounded-lg bg-white px-3 py-2.5">
          <p className="text-sm text-zinc-500">
            Whole-bill discount ({trimPercent(sale.discountPercent)}%)
          </p>
          <span className="num shrink-0 text-sm font-semibold text-emerald-600">
            −{formatPKR(billSaving)}
          </span>
        </div>
      ) : null}

      {sale.notes ? (
        <p className="px-1 pt-1 text-sm text-zinc-500">
          <span className="font-medium text-zinc-600">Notes:</span> {sale.notes}
        </p>
      ) : null}
    </div>
  );
}
