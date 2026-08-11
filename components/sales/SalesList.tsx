"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GlassWater,
  LogIn,
  Plus,
  RefreshCw,
  ShoppingBag,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { DeleteSaleDialog } from "@/components/sales/DeleteSaleDialog";
import { SaleLineItems } from "@/components/sales/SaleLineItems";
import { EmptyState } from "@/components/shared/EmptyState";
import { ExportCsvButton } from "@/components/shared/ExportCsvButton";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatPKR } from "@/lib/format";
import {
  useSales,
  useDeleteSale,
  type SaleListRow,
} from "@/lib/hooks/use-sales";
import { useCustomers } from "@/lib/hooks/use-customers";
import { collapseInOut, SPRING } from "@/lib/motion";
import { MODULE_BUTTON_CLASS, MODULE_RING_CLASS, type SaleModule } from "@/lib/sale-modules";
import { cn } from "@/lib/utils";
import { CUSTOMER_TYPE_LABELS } from "@/lib/validations/customers";

const PAGE_SIZE = 10;

/**
 * Empty-state icon per module, mirroring the sidebar icons in lib/nav.ts.
 * Kept here rather than on SaleModule so that config stays icon-free and can be
 * imported by route handlers without dragging lucide into a server bundle.
 */
const MODULE_ICON: Record<string, LucideIcon> = {
  beverages: GlassWater,
  bakery: ShoppingBag,
};

/**
 * Beverage sales list.
 *
 * One layout, not two: each sale is a CARD on every breakpoint, widening on
 * desktop. A traditional table would force horizontal scrolling on a phone,
 * which is the thing the brief rules out — and money that scrolls out of view
 * is money the owner cannot check.
 */
export function SalesList({ module }: { module: SaleModule }) {
  const reduceMotion = useReducedMotion();
  const primaryButton = MODULE_BUTTON_CLASS[module.accent];

  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SaleListRow | null>(null);

  /**
   * A backwards range is caught HERE, before the request goes out. The owner
   * routinely moves "From" past the current "To" while adjusting a range, and
   * the server rightly 400s that — but a rejected query used to blank the whole
   * page, taking the date inputs with it and leaving no way to correct the very
   * thing that was wrong. Both dates are `yyyy-MM-dd`, so a string compare is
   * the correct chronological compare.
   */
  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  const customersQuery = useCustomers();
  const salesQuery = useSales(
    module,
    {
      page,
      limit: PAGE_SIZE,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      customerId: customerId || undefined,
    },
    // Don't fire a request we already know is invalid; the inline hint below is
    // the feedback, and the previous results stay on screen meanwhile.
    { enabled: !invalidRange }
  );
  const deleteSale = useDeleteSale(module);

  const hasFilters = Boolean(dateFrom || dateTo || customerId);

  /** Any filter change invalidates the current page number. */
  function updateFilter(apply: () => void) {
    apply();
    setPage(1);
    setExpandedId(null);
  }

  function clearFilters() {
    updateFilter(() => {
      setDateFrom("");
      setDateTo("");
      setCustomerId("");
    });
  }

  const header = (
    <PageHeader
      title={module.label}
      description={module.listDescription}
      accent={module.accent}
      action={
        <div className="flex gap-2">
          {/* Exports exactly what the filters currently show. Passing the same
              dateFrom/dateTo the list is using is what keeps the file and the
              screen in agreement; with no range set it exports everything. */}
          <ExportCsvButton
            type={module.exportType}
            dateFrom={dateFrom || undefined}
            dateTo={dateTo || undefined}
            label="Export"
            disabled={invalidRange}
          />
          <Button asChild className={cn("h-11 rounded-lg", primaryButton)}>
            <Link href={module.newSaleRoute}>
              <Plus className="mr-2 size-4" aria-hidden />
              New sale
            </Link>
          </Button>
        </div>
      }
    />
  );

  // ------------------------------------------------------------------
  // Session / error states
  // ------------------------------------------------------------------

  if (
    salesQuery.error instanceof ApiError &&
    salesQuery.error.isSessionExpired
  ) {
    return (
      <>
        {header}
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to see your sales."
          accent={module.accent}
          action={
            <Button
              className={cn("h-11 rounded-lg", primaryButton)}
              onClick={redirectToLogin}
            >
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  const sales = salesQuery.data?.sales ?? [];
  const pagination = salesQuery.data?.pagination;

  return (
    <>
      {header}

      {/* Filters ------------------------------------------------------ */}
      <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="filter-from">From</Label>
            <Input
              id="filter-from"
              type="date"
              value={dateFrom}
              // No `max`: clamping From to the current To stops the owner
              // moving the start forward first, which is a normal way to shift
              // a whole range. The inline hint below handles the crossed state.
              aria-invalid={invalidRange || undefined}
              aria-describedby={invalidRange ? "filter-range-error" : undefined}
              className={cn(
                "num h-11 rounded-lg",
                invalidRange && "border-rose-400 focus-visible:ring-rose-400"
              )}
              onChange={(event) =>
                updateFilter(() => setDateFrom(event.target.value))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-to">To</Label>
            <Input
              id="filter-to"
              type="date"
              value={dateTo}
              aria-invalid={invalidRange || undefined}
              aria-describedby={invalidRange ? "filter-range-error" : undefined}
              className={cn(
                "num h-11 rounded-lg",
                invalidRange && "border-rose-400 focus-visible:ring-rose-400"
              )}
              onChange={(event) =>
                updateFilter(() => setDateTo(event.target.value))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-customer">Customer</Label>
            <select
              id="filter-customer"
              value={customerId}
              onChange={(event) =>
                updateFilter(() => setCustomerId(event.target.value))
              }
              className={cn(
                "h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2",
                MODULE_RING_CLASS[module.accent]
              )}
            >
              <option value="">All customers</option>
              {(customersQuery.data ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {invalidRange ? (
          <p
            id="filter-range-error"
            role="alert"
            className="mt-3 text-sm text-rose-600"
          >
            The start date is after the end date. Adjust either date — or{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
              onClick={() =>
                updateFilter(() => {
                  setDateFrom(dateTo);
                  setDateTo(dateFrom);
                })
              }
            >
              swap them
            </button>
            .
          </p>
        ) : null}

        {hasFilters ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="num text-sm text-zinc-500">
              {invalidRange
                ? "Showing the last valid results"
                : pagination
                  ? `${pagination.total} matching`
                  : "Filtering…"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 rounded-lg"
              onClick={clearFilters}
            >
              <X className="mr-1.5 size-3.5" aria-hidden />
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>

      {/* List --------------------------------------------------------- */}
      {/* A failed query is a RESULTS-area error, never a whole-page one. The
          filters above it are the controls the owner needs in order to recover
          — blanking the page would take away the only means of fixing what is
          wrong and leave a "Try again" that just repeats the same request. */}
      {salesQuery.error ? (
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load sales"
          description={
            salesQuery.error instanceof ApiError
              ? salesQuery.error.message
              : "Something went wrong."
          }
          accent={module.accent}
          action={
            <Button
              className={cn("h-11 rounded-lg", primaryButton)}
              onClick={() => salesQuery.refetch()}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      ) : salesQuery.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[92px] w-full rounded-xl" />
          ))}
        </div>
      ) : sales.length === 0 ? (
        <EmptyState
          icon={MODULE_ICON[module.key] ?? ShoppingBag}
          title={
            hasFilters ? "No sales match those filters" : module.emptyTitle
          }
          description={
            hasFilters
              ? "Try widening the date range or clearing the customer filter."
              : "Record your first sale."
          }
          accent={module.accent}
          action={
            hasFilters ? (
              <Button
                variant="outline"
                className="h-11 rounded-lg"
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            ) : (
              <Button
                asChild
                className={cn("h-11 rounded-lg", primaryButton)}
              >
                <Link href={module.newSaleRoute}>
                  <Plus className="mr-2 size-4" aria-hidden />
                  New sale
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div
          className={cn(
            "space-y-3",
            // Dim the list while a filter/page refetch is in flight, so the
            // stale page reads as "updating", never as the final answer.
            salesQuery.isFetching && "opacity-60 transition-opacity"
          )}
        >
          {/* Row-level AnimatePresence: a DELETED sale animates out instead of
              blinking away. Separate from the per-row AnimatePresence further
              down, which owns the expand/collapse of that row's line items. */}
          <AnimatePresence initial={false}>
          {sales.map((sale) => {
            const isExpanded = expandedId === sale.id;

            return (
              <motion.article
                key={sale.id}
                layout={reduceMotion ? false : "position"}
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, height: 0, marginTop: 0 }
                }
                transition={SPRING.saleRow}
                className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
              >
                <div className="flex items-start gap-2 p-4">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={`sale-items-${sale.id}`}
                    onClick={() => setExpandedId(isExpanded ? null : sale.id)}
                    className={cn(
                      "min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2",
                      MODULE_RING_CLASS[module.accent]
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 text-zinc-400 transition-transform",
                          isExpanded && "rotate-180"
                        )}
                        aria-hidden
                      />
                      <p className="truncate text-[15px] font-medium text-zinc-900">
                        {sale.customer.name}
                      </p>
                    </div>

                    <p className="num mt-1 pl-6 text-sm text-zinc-500">
                      {formatDate(sale.saleDate)}
                      <span className="mx-1.5 text-zinc-300">·</span>
                      {sale.itemCount} {sale.itemCount === 1 ? "item" : "items"}
                      <span className="mx-1.5 text-zinc-300">·</span>
                      {CUSTOMER_TYPE_LABELS[sale.customer.type]}
                    </p>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <span className="num text-[17px] font-semibold text-zinc-900">
                      {formatPKR(sale.totalAmount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(sale)}
                      className="flex size-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    >
                      <Trash2 className="size-4" aria-hidden />
                      <span className="sr-only">
                        Delete sale to {sale.customer.name}
                      </span>
                    </button>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {isExpanded ? (
                    <motion.div
                      id={`sale-items-${sale.id}`}
                      key="items"
                      {...collapseInOut(reduceMotion)}
                      className="overflow-hidden"
                    >
                      <SaleLineItems module={module} saleId={sale.id} />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.article>
            );
          })}
          </AnimatePresence>
        </div>
      )}

      {/* Pagination --------------------------------------------------- */}
      {pagination && pagination.totalPages > 1 ? (
        <nav
          className="mt-5 flex items-center justify-between gap-3"
          aria-label="Sales pages"
        >
          <Button
            variant="outline"
            className="h-11 rounded-lg"
            disabled={page <= 1 || salesQuery.isFetching}
            onClick={() => {
              setPage((current) => Math.max(1, current - 1));
              setExpandedId(null);
            }}
          >
            <ChevronLeft className="mr-1 size-4" aria-hidden />
            Previous
          </Button>

          <p className="num text-sm text-zinc-500" aria-live="polite">
            Page {pagination.page} of {pagination.totalPages}
          </p>

          <Button
            variant="outline"
            className="h-11 rounded-lg"
            disabled={page >= pagination.totalPages || salesQuery.isFetching}
            onClick={() => {
              setPage((current) => current + 1);
              setExpandedId(null);
            }}
          >
            Next
            <ChevronRight className="ml-1 size-4" aria-hidden />
          </Button>
        </nav>
      ) : null}

      <DeleteSaleDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        customerName={pendingDelete?.customer.name ?? ""}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteSale.mutateAsync(pendingDelete.id);
            toast.success(`Sale to ${pendingDelete.customer.name} deleted`);
            setExpandedId(null);
            // Deleting the last row on a page would otherwise strand the owner
            // on an empty page that no longer exists.
            if (sales.length === 1 && page > 1) setPage((current) => current - 1);
          } catch (error) {
            if (error instanceof ApiError && error.isSessionExpired) {
              toast.error(error.message);
              redirectToLogin();
              return;
            }
            toast.error(
              error instanceof ApiError
                ? error.message
                : "Couldn't delete the sale."
            );
            throw error;
          }
        }}
      />
    </>
  );
}
