"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  LogIn,
  Milk,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { MilkSaleDialog } from "@/components/milk/MilkSaleDialog";
import { AnimatedMoney } from "@/components/shared/AnimatedMoney";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ExportCsvButton } from "@/components/shared/ExportCsvButton";
import { MoneyText } from "@/components/shared/MoneyText";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { enterUp } from "@/lib/motion";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatLiters, formatPKR } from "@/lib/format";
import {
  useCreateMilkSale,
  useDeleteMilkSale,
  useMilkSales,
  useUpdateMilkSale,
  type MilkSale,
} from "@/lib/hooks/use-milk";
import { MODULE_BUTTON_CLASS } from "@/lib/sale-modules";
import { cn } from "@/lib/utils";

/**
 * Milk SOLD — to hotels, shops and individuals. Money in.
 *
 * Deliberately its own screen rather than a tab on the milk hub: the hub is
 * about farmers and money going OUT, and mixing the two directions on one
 * screen is how an owner reads a number with the wrong sign.
 *
 * A milk sale is REVENUE and nothing more. It no longer feeds any "outstanding"
 * figure — there is none — but it still carries its customer, so it still shows
 * up on that customer's purchase history and in reports revenue. That is why
 * the mutations still invalidate the customers cache alongside the milk one.
 */
export function MilkSalesList() {
  const reduceMotion = useReducedMotion();
  const [page, setPage] = useState(1);

  const salesQuery = useMilkSales({ page });
  const createSale = useCreateMilkSale();
  const updateSale = useUpdateMilkSale();
  const deleteSale = useDeleteMilkSale();

  const [dialog, setDialog] = useState<{
    open: boolean;
    target: MilkSale | null;
  }>({ open: false, target: null });
  const [deleteTarget, setDeleteTarget] = useState<MilkSale | null>(null);

  function handleError(fallback: string) {
    return (error: unknown) => {
      if (error instanceof ApiError && error.isSessionExpired) {
        toast.error(error.message);
        redirectToLogin();
        return;
      }
      toast.error(error instanceof ApiError ? error.message : fallback);
    };
  }

  const header = (
    <>
      <Link
        href="/milk"
        className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Milk shop
      </Link>
      <PageHeader
        title="Milk sales"
        accent="emerald"
        description="Milk you sold to hotels, shops and individuals."
        action={
          <div className="flex gap-2">
            <ExportCsvButton type="milk_sales" label="Export" />
            <Button
              className={cn("h-11 rounded-lg", MODULE_BUTTON_CLASS.emerald)}
              onClick={() => setDialog({ open: true, target: null })}
            >
              <Plus className="mr-2 size-4" aria-hidden />
              Record sale
            </Button>
          </div>
        }
      />
    </>
  );

  if (salesQuery.error instanceof ApiError && salesQuery.error.isSessionExpired) {
    return (
      <>
        {header}
        <EmptyState
          icon={LogIn}
          accent="emerald"
          title="Your session expired"
          description="Please sign in again to see your milk sales."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  if (salesQuery.error) {
    return (
      <>
        {header}
        <EmptyState
          icon={RefreshCw}
          accent="emerald"
          title="Couldn't load milk sales"
          description={
            salesQuery.error instanceof ApiError
              ? salesQuery.error.message
              : "Something went wrong."
          }
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => salesQuery.refetch()}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  const sales = salesQuery.data?.sales ?? [];
  const totals = salesQuery.data?.totals;
  const pagination = salesQuery.data?.pagination;

  return (
    <>
      {header}

      {/* Totals cover the WHOLE filtered set, not just this page — the server
          aggregates them, so paging never changes the headline figure. */}
      <motion.div
        {...enterUp(reduceMotion)}
        className="mb-4 grid gap-3 sm:grid-cols-2"
      >
        <div className="rounded-xl border border-emerald-100 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            Sold
          </p>
          {salesQuery.isPending ? (
            <Skeleton className="mt-3 h-9 w-32 rounded-lg" />
          ) : (
            <AnimatedMoney
              value={totals?.amount ?? 0}
              countUpOnMount
              className="mt-2 block text-[28px] font-bold leading-tight text-emerald-600"
            />
          )}
          <p className="mt-1 text-sm text-zinc-500">all time</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            Litres
          </p>
          {salesQuery.isPending ? (
            <Skeleton className="mt-3 h-9 w-24 rounded-lg" />
          ) : (
            <p className="num mt-2 text-[28px] font-bold leading-tight text-zinc-900">
              {formatLiters(totals?.liters ?? 0)}
            </p>
          )}
          <p className="mt-1 text-sm text-zinc-500">
            {pagination?.total ?? 0}{" "}
            {(pagination?.total ?? 0) === 1 ? "sale" : "sales"}
          </p>
        </div>
      </motion.div>

      {salesQuery.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[88px] w-full rounded-xl" />
          ))}
        </div>
      ) : sales.length === 0 ? (
        <EmptyState
          icon={Milk}
          accent="emerald"
          title="No milk sales yet"
          description="Record the milk you sell to hotels and shops. It goes straight onto their balance."
          action={
            <Button
              className={cn("h-11 rounded-lg", MODULE_BUTTON_CLASS.emerald)}
              onClick={() => setDialog({ open: true, target: null })}
            >
              <Plus className="mr-2 size-4" aria-hidden />
              Record sale
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {sales.map((sale) => (
            <div
              key={sale.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-zinc-900">
                    {sale.customer.name}
                  </p>
                  <p className="num mt-1 text-sm text-zinc-500">
                    {formatDate(sale.saleDate)}
                    <span className="mx-1.5 text-zinc-300">·</span>
                    {formatLiters(sale.liters)} × {formatPKR(sale.ratePerLiter)}
                  </p>
                  {sale.notes ? (
                    <p className="mt-1 text-sm text-zinc-500">{sale.notes}</p>
                  ) : null}
                </div>

                <div className="shrink-0 text-right">
                  <MoneyText
                    value={sale.totalAmount}
                    tone="emerald"
                    className="text-[17px] font-semibold"
                  />
                  <div className="mt-2 flex justify-end gap-1">
                    <button
                      type="button"
                      aria-label="Edit sale"
                      onClick={() => setDialog({ open: true, target: sale })}
                      className="flex size-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete sale"
                      onClick={() => setDeleteTarget(sale)}
                      className="flex size-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            className="h-11 rounded-lg"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <p className="num text-sm text-zinc-500">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <Button
            variant="outline"
            className="h-11 rounded-lg"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      <MilkSaleDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        mode={dialog.target ? "edit" : "create"}
        initial={dialog.target}
        isPending={createSale.isPending || updateSale.isPending}
        onSubmit={(values) => {
          const target = dialog.target;
          const done = {
            onSuccess: () => {
              toast.success(target ? "Sale updated" : "Sale recorded");
              setDialog({ open: false, target: null });
            },
            onError: handleError("Couldn't save the sale."),
          };
          if (target) {
            // customerId is intentionally not sent — the API rejects it and the
            // dialog does not offer it.
            const { customerId, ...patch } = values;
            void customerId;
            updateSale.mutate({ id: target.id, ...patch }, done);
          } else {
            createSale.mutate(values, done);
          }
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this milk sale?"
        description={
          deleteTarget
            ? `The sale to ${deleteTarget.customer.name} will be removed permanently and their balance will go down by that amount. This can't be undone.`
            : ""
        }
        confirmLabel="Delete sale"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteSale.mutateAsync(deleteTarget.id);
            toast.success("Sale deleted");
            setDeleteTarget(null);
          } catch (error) {
            handleError("Couldn't delete the sale.")(error);
            // Rethrow so the dialog stays open — a failed delete that closes
            // looks exactly like a successful one.
            throw error;
          }
        }}
      />
    </>
  );
}
