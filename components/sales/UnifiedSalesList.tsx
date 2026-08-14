"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  LogIn,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { DateRangeFilter } from "@/components/sales/DateRangeFilter";
import { DeleteSaleDialog } from "@/components/sales/DeleteSaleDialog";
import { UnifiedSaleLineItems } from "@/components/sales/UnifiedSaleLineItems";
import { EmptyState } from "@/components/shared/EmptyState";
import { ExportCsvButton } from "@/components/shared/ExportCsvButton";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatPKR } from "@/lib/format";
import { useCustomers } from "@/lib/hooks/use-customers";
import {
  useDeleteUnifiedSale,
  useUnifiedSales,
  type UnifiedSaleListRow,
} from "@/lib/hooks/use-unified-sales";
import { collapseInOut, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CUSTOMER_TYPE_LABELS } from "@/lib/validations/customers";

const PAGE_SIZE = 10;

/** The shop chips on a list row. Zinc for a key this build does not know. */
const MODULE_CHIP: Record<string, { class: string; label: string }> = {
  beverages: { class: "bg-blue-50 text-blue-700", label: "Beverages" },
  bakery: { class: "bg-amber-50 text-amber-700", label: "Bakery" },
  milk: { class: "bg-emerald-50 text-emerald-700", label: "Milk" },
};

/**
 * The UNIFIED sales list.
 *
 * One layout, not two: each bill is a CARD at every breakpoint, widening on
 * desktop. A table would force horizontal scrolling on a phone, and money that
 * scrolls out of view is money the owner cannot check.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SHOWS THAT A PER-MODULE LIST CANNOT
 * ---------------------------------------------------------------------------
 * The SHOP CHIPS. A bill may hold beverage, bakery and milk lines at once, so
 * the row says which — from the lines' snapshotted `moduleKey`s, in a fixed
 * order the server sets, never from the products' categories today.
 *
 * Export CSV writes the `sales` type (added in S6): one row per BILL, with the
 * shops it drew from, so a spreadsheet can sum the Total column without
 * double-counting a mixed bill.
 *
 * Accent is ZINC throughout: the Design System forbids mixing module accents on
 * one screen, and a cross-module bill has no single one.
 */
export function UnifiedSalesList() {
  const reduceMotion = useReducedMotion();

  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UnifiedSaleListRow | null>(null);

  /**
   * A backwards range is caught HERE, before the request goes out. The owner
   * routinely moves "From" past the current "To" while adjusting a range, and
   * the server rightly 400s that — but a rejected query would blank the page,
   * taking the date inputs with it. Both dates are `yyyy-MM-dd`, so a string
   * compare is the correct chronological compare.
   */
  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  const customersQuery = useCustomers();
  const salesQuery = useUnifiedSales(
    {
      page,
      limit: PAGE_SIZE,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      customerId: customerId || undefined,
    },
    { enabled: !invalidRange }
  );
  const deleteSale = useDeleteUnifiedSale();

  const hasFilters = Boolean(dateFrom || dateTo || customerId);

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
      title="Sales"
      description="Every bill, across beverages, bakery and milk."
      accent="zinc"
      action={
        <div className="flex gap-2">
          {/* Exports exactly what the filters currently show, same contract as
              the per-module lists. Landed with S6 — before that there was no
              unified export type and a button would have produced a wrong file. */}
          <ExportCsvButton
            type="sales"
            dateFrom={dateFrom || undefined}
            dateTo={dateTo || undefined}
            label="Export"
            disabled={invalidRange}
          />
          <Button asChild className="h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800">
            <Link href="/sales/new">
              <Plus className="mr-2 size-4" aria-hidden />
              New sale
            </Link>
          </Button>
        </div>
      }
    />
  );

  if (salesQuery.error instanceof ApiError && salesQuery.error.isSessionExpired) {
    return (
      <>
        {header}
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to see your sales."
          accent="zinc"
          action={
            <Button
              className="h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800"
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
          {/* DD/MM/YYYY, not the device's locale (CHECKLIST #12). A native
              date input renders mm/dd/yyyy here, which reads American against
              every other date the app prints. */}
          <DateRangeFilter
            from={dateFrom}
            to={dateTo}
            invalid={invalidRange}
            onChange={(next) =>
              updateFilter(() => {
                if (next.from !== undefined) setDateFrom(next.from);
                if (next.to !== undefined) setDateTo(next.to);
              })
            }
          />

          <div className="space-y-1.5">
            <Label htmlFor="filter-customer">Customer</Label>
            <select
              id="filter-customer"
              value={customerId}
              onChange={(event) =>
                updateFilter(() => setCustomerId(event.target.value))
              }
              className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
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
          <p id="filter-range-error" role="alert" className="mt-3 text-sm text-rose-600">
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
            <Button variant="ghost" size="sm" className="h-9 rounded-lg" onClick={clearFilters}>
              <X className="mr-1.5 size-3.5" aria-hidden />
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>

      {/* List --------------------------------------------------------- */}
      {/* A failed query is a RESULTS-area error, never a whole-page one: the
          filters above are the controls the owner needs in order to recover. */}
      {salesQuery.error ? (
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load sales"
          description={
            salesQuery.error instanceof ApiError
              ? salesQuery.error.message
              : "Something went wrong."
          }
          accent="zinc"
          action={
            <Button
              className="h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800"
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
          icon={ReceiptText}
          title={hasFilters ? "No sales match those filters" : "No sales yet"}
          description={
            hasFilters
              ? "Try widening the date range or clearing the customer filter."
              : "Ring up your first bill — any product from any shop."
          }
          accent="zinc"
          action={
            hasFilters ? (
              <Button variant="outline" className="h-11 rounded-lg" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button asChild className="h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800">
                <Link href="/sales/new">
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
            // Dim while a refetch is in flight, so a stale page reads as
            // "updating" rather than as the final answer.
            salesQuery.isFetching && "opacity-60 transition-opacity"
          )}
        >
          <AnimatePresence initial={false}>
            {sales.map((sale) => {
              const isExpanded = expandedId === sale.id;

              return (
                <motion.article
                  key={sale.id}
                  layout={reduceMotion ? false : "position"}
                  exit={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: 0 }
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
                      className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
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

                      {/* Which shops this ONE bill drew from. Order comes from
                          the server and is fixed, so a row cannot relabel
                          itself between reloads. */}
                      <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                        {sale.modules.map((moduleKey) => {
                          const chip = MODULE_CHIP[moduleKey];
                          return (
                            <span
                              key={moduleKey}
                              className={cn(
                                "rounded-md px-2 py-0.5 text-xs font-medium",
                                chip?.class ?? "bg-zinc-100 text-zinc-600"
                              )}
                            >
                              {chip?.label ?? moduleKey}
                            </span>
                          );
                        })}
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                      <span className="num text-[17px] font-semibold text-zinc-900">
                        {formatPKR(sale.totalAmount)}
                      </span>
                      {/* Edit (CHECKLIST #8). A link, not a dialog: correcting a
                          bill is the same work as ringing it up. */}
                      <Link
                        href={`/sales/${sale.id}/edit`}
                        className="flex size-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
                      >
                        <Pencil className="size-4" aria-hidden />
                        <span className="sr-only">
                          Edit sale to {sale.customer.name}
                        </span>
                      </Link>
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
                        <UnifiedSaleLineItems saleId={sale.id} />
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
        <nav className="mt-5 flex items-center justify-between gap-3" aria-label="Sales pages">
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
            // Deleting a bill RESTORES its stock, server-side in the same
            // transaction — worth saying, because it is the reason deleting a
            // mistaken bill is safe rather than something to be undone by hand.
            toast.success(`Sale to ${pendingDelete.customer.name} deleted · stock restored`);
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
              error instanceof ApiError ? error.message : "Couldn't delete the sale."
            );
            throw error;
          }
        }}
      />
    </>
  );
}
