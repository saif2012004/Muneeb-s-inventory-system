"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSize } from "@/lib/catalog-display";
import { formatPKR } from "@/lib/format";
import { useBeverageSale } from "@/lib/hooks/use-beverage-sales";

/**
 * The line items shown inside an expanded sale row, fetched on demand.
 *
 * Every figure here is the line's OWN stored snapshot — `unitPrice` and
 * `lineTotal` as they were when the sale was written. The product is joined for
 * its name only; today's catalog price is never shown against a past sale
 * (Gotcha 5).
 */
export function SaleLineItems({ saleId }: { saleId: string }) {
  const saleQuery = useBeverageSale(saleId);

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

  const sale = saleQuery.data;
  if (!sale) return null;

  return (
    <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/60 p-4">
      {sale.items.map((item) => {
        const detail = [
          formatSize(item.product.size) !== "—" ? formatSize(item.product.size) : null,
          item.product.discountPercent ? `${item.product.discountPercent}% off` : null,
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
                {item.quantity} × {formatPKR(item.unitPrice)}
              </p>
            </div>
            <span className="num shrink-0 text-sm font-semibold text-zinc-900">
              {formatPKR(item.lineTotal)}
            </span>
          </div>
        );
      })}

      {sale.notes ? (
        <p className="px-1 pt-1 text-sm text-zinc-500">
          <span className="font-medium text-zinc-600">Notes:</span> {sale.notes}
        </p>
      ) : null}
    </div>
  );
}
