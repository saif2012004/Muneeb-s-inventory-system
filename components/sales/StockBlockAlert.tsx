"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { InlineStockEditor } from "@/components/catalog/InlineStockEditor";
import { Button } from "@/components/ui/button";
import type { StockShortfall } from "@/lib/api-client";

/**
 * Shown when the server refused a sale for insufficient stock.
 *
 * ---------------------------------------------------------------------------
 * WHY RESTOCK IS INLINE AND NOT A LINK TO THE CATALOG
 * ---------------------------------------------------------------------------
 * The obvious implementation — "Not enough stock, go to Catalog" — throws away
 * the half-entered sale. The owner would have to leave the form, find the
 * product, fix the number, come back and retype everything, at the till, with a
 * customer waiting. So the catalog's stock editor is mounted right here instead:
 * same component, same mutation, same optimistic update, no navigation.
 *
 * ---------------------------------------------------------------------------
 * IT READS FROM `shortBy`, NOT FROM THE MESSAGE
 * ---------------------------------------------------------------------------
 * Every figure below comes from the structured `shortBy` array the API returns —
 * product id, name, available, requested, shortfall. Nothing is parsed out of
 * the sentence. That is the same contract as the catalog delete guard's
 * `blockedBy`, and for the same reason: prose is for reading, fields are for
 * acting on. The id in particular is what lets Restock target the right product
 * even if two products share a name.
 */
export function StockBlockAlert({
  shortfalls,
  message,
  onRetry,
  isRetrying,
}: {
  shortfalls: StockShortfall[];
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-200 bg-rose-50/70 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-5 shrink-0 text-rose-600"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-rose-900">
            Not enough stock
          </p>
          <p className="mt-0.5 text-sm text-rose-800">{message}</p>

          <ul className="mt-3 space-y-2">
            {shortfalls.map((short, index) => (
              <li
                key={short.productId}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {short.name}
                  </p>
                  {/* The three numbers, spelled out. "Short by N" is the one the
                      owner actually acts on, so it is said rather than left to
                      be worked out from the other two. */}
                  <p className="num mt-0.5 text-xs text-zinc-500">
                    {short.available} in stock · needs {short.requested} ·{" "}
                    <span className="font-medium text-rose-600">
                      short by {short.shortfall}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Restock
                  </span>
                  <InlineStockEditor
                    productId={short.productId}
                    productName={short.name}
                    stock={short.available}
                    // The catalog list this writes through is the active-products
                    // one, which is what the sale form itself reads.
                    includeInactive={false}
                    // First row opens straight into the input: it is the whole
                    // reason this alert appeared, so it should not need a tap.
                    autoFocus={index === 0}
                  />
                </div>
              </li>
            ))}
          </ul>

          <Button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="mt-3 h-11 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
          >
            {isRetrying ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 size-4" aria-hidden />
                Save sale again
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
