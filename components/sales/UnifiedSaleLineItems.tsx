"use client";

import Link from "next/link";
import { Printer, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { composeProductDetail } from "@/lib/catalog-display";
import { formatPKR } from "@/lib/format";
import { useUnifiedSale } from "@/lib/hooks/use-unified-sales";
import { formatQuantityWithUnit } from "@/lib/sale-catalog";
import { cn } from "@/lib/utils";

/**
 * The lines inside an expanded UNIFIED sale row, fetched on demand.
 *
 * Every figure is the line's OWN stored snapshot — `unitPrice` and `lineTotal`
 * as they were when the bill was written. The product is joined for its name
 * only; today's catalog price is never shown against a past sale (Gotcha 5).
 *
 * The one thing this shows that the per-module version cannot: **which shop each
 * line was sold as**, from the line's snapshotted `moduleKey`. On a mixed bill
 * that is the difference between "12.5 × Rs. 120" meaning litres of milk and
 * meaning something else entirely.
 */

/** Module dot + word for a line. Zinc for anything unrecognised. */
const MODULE_STYLE: Record<string, { dot: string; label: string }> = {
  beverages: { dot: "bg-blue-600", label: "Beverages" },
  bakery: { dot: "bg-amber-600", label: "Bakery" },
  milk: { dot: "bg-emerald-600", label: "Milk" },
};

export function UnifiedSaleLineItems({ saleId }: { saleId: string }) {
  const saleQuery = useUnifiedSale(saleId);

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
        // The attributes the picker shows, so a line reads the way it was
        // chosen — MINUS anything the product name already says. Rendering them
        // blindly next to the name gave "Biscuits Simple · Simple" and
        // "Pepsi 1L · 1L" (the receipt had the identical bug). One shared
        // implementation, so the two cannot drift apart again.
        const detail = composeProductDetail(item.product);

        const moduleStyle = MODULE_STYLE[item.moduleKey];

        return (
          <div
            key={item.id}
            className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm font-medium text-zinc-900">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    moduleStyle?.dot ?? "bg-zinc-400"
                  )}
                  // The words are on the line below; the dot is decoration.
                  aria-hidden
                />
                <span className="truncate">{item.product.name}</span>
                {!item.product.isActive ? (
                  <span className="text-xs font-normal text-zinc-400">(inactive)</span>
                ) : null}
              </p>
              <p className="num mt-0.5 pl-4 text-xs text-zinc-500">
                {/* The SNAPSHOTTED module, never re-derived from the product's
                    category today — that is what keeps a closed bill's
                    attribution stable if the owner recategorises a product. */}
                {moduleStyle?.label ?? item.moduleKey}
                {detail ? ` · ${detail}` : ""} ·{" "}
                {formatQuantityWithUnit(
                  item.quantity,
                  item.product.unit,
                  item.unitName
                )} ×{" "}
                {formatPKR(item.unitPrice)}
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

      {/* Opens the print view, which lives OUTSIDE the (dashboard) group so no
          nav is rendered around the receipt. A plain link, not a fetch: the
          receipt is server-rendered from the stored sale. */}
      <div className="px-1 pt-2">
        <Button asChild variant="outline" className="h-11 rounded-lg">
          <Link href={`/receipt/sale/${saleId}`}>
            <Printer className="mr-2 size-4" aria-hidden />
            Print receipt
          </Link>
        </Button>
      </div>
    </div>
  );
}
