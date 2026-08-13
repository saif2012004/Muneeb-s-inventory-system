"use client";

import { useState } from "react";
import { ArrowLeft, LogIn, Pencil, RefreshCw } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { CustomerDialog } from "@/components/customers/CustomerDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatPKR } from "@/lib/format";
import {
  useCustomerProfile,
  useUpdateCustomer,
  type Purchase,
} from "@/lib/hooks/use-customers";
import {
  MODULE_DOT_CLASS,
  MODULE_HREF,
  MODULE_LABEL,
} from "@/lib/receivables-display";
import { cn } from "@/lib/utils";
import { CUSTOMER_TYPE_LABELS } from "@/lib/validations/customers";

/**
 * One customer: who they are, and what they have bought.
 *
 * ---------------------------------------------------------------------------
 * NO BALANCE, NO PAYMENTS, BY DESIGN
 * ---------------------------------------------------------------------------
 * This screen used to carry Total billed / Total paid / Outstanding tiles, a
 * Payments tab with "Record payment", and a running-balance ledger. All of it
 * is gone: a sale is revenue, not a debt, so there is nothing outstanding to
 * show and nothing to settle.
 *
 * What stays is the PURCHASE HISTORY — the reason to open a customer at all,
 * and the thing worth preserving. Every sale still carries its customer, so
 * this list is unaffected by the change and will keep filling up as normal.
 *
 * The `CustomerPayment` table and lib/receivables.ts both still exist and still
 * work. Nothing calls them. Restoring this is UI work plus re-adding the fields
 * to /api/customers/[id] — no migration, no lost rows.
 *
 * The tabs went with it. One tab is not a tab bar, it is a heading — and the
 * shadcn `TabsTrigger` was on the Phase 8 list for being 28px against a 44px
 * minimum, so this quietly removes two of those touch targets as well.
 */
export function CustomerProfile({ customerId }: { customerId: string }) {
  const [editOpen, setEditOpen] = useState(false);

  const profileQuery = useCustomerProfile(customerId);
  const updateCustomer = useUpdateCustomer();

  const backLink = (
    <Link
      href="/customers"
      className="mb-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
    >
      <ArrowLeft className="size-4" aria-hidden />
      All customers
    </Link>
  );

  // ------------------------------------------------------------------
  // Session / error / loading
  // ------------------------------------------------------------------

  if (
    profileQuery.error instanceof ApiError &&
    profileQuery.error.isSessionExpired
  ) {
    return (
      <>
        {backLink}
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to see this customer."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  if (profileQuery.error) {
    return (
      <>
        {backLink}
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load this customer"
          description={
            profileQuery.error instanceof ApiError
              ? profileQuery.error.message
              : "Something went wrong."
          }
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => profileQuery.refetch()}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  if (profileQuery.isPending) {
    return (
      <>
        {backLink}
        <Skeleton className="h-10 w-56 rounded-lg" />
        <Skeleton className="mt-6 h-64 w-full rounded-xl" />
      </>
    );
  }

  const { customer, purchases } = profileQuery.data;

  return (
    <>
      {backLink}

      <PageHeader
        title={customer.name}
        description={[
          CUSTOMER_TYPE_LABELS[customer.type],
          customer.phone,
          customer.isActive ? null : "Inactive",
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <Button
            variant="outline"
            className="h-11 rounded-lg"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="mr-2 size-4" aria-hidden />
            Edit
          </Button>
        }
      />

      {/* Purchase history --------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-3 text-[18px] font-semibold text-zinc-900">
          Purchases
          <span className="num ml-2 text-sm font-normal text-zinc-500">
            {purchases.length}
          </span>
        </h2>
        <PurchasesList purchases={purchases} />
      </section>

      <CustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        initial={{
          name: customer.name,
          phone: customer.phone,
          type: customer.type,
        }}
        isPending={updateCustomer.isPending}
        onSubmit={(values) =>
          updateCustomer.mutate(
            { id: customer.id, ...values },
            {
              onSuccess: () => {
                toast.success("Customer updated");
                setEditOpen(false);
              },
              onError: (error) => {
                if (error instanceof ApiError) {
                  if (error.isSessionExpired) {
                    toast.error(error.message);
                    redirectToLogin();
                    return;
                  }
                  toast.error(error.message);
                  return;
                }
                toast.error("Couldn't update the customer.");
              },
            }
          )
        }
      />
    </>
  );
}

/** Purchases across all three modules, newest first, each tagged by module. */
function PurchasesList({ purchases }: { purchases: Purchase[] }) {
  if (purchases.length === 0) {
    return (
      <EmptyState
        title="No purchases yet"
        description="Sales recorded for this customer will appear here."
      />
    );
  }

  return (
    <div className="space-y-2">
      {purchases.map((purchase) => {
        // Milk has no sale detail page, so those rows stay flat rather than
        // linking somewhere that 404s. From a MAP, not `/${module}`: a unified
        // bill's module is "unified" and `/unified` is not a route.
        const href = MODULE_HREF[purchase.module] ?? null;

        const body = (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    MODULE_DOT_CLASS[purchase.module]
                  )}
                  aria-hidden
                />
                <p className="truncate text-[15px] font-medium text-zinc-900">
                  {MODULE_LABEL[purchase.module]}
                </p>
              </div>
              <p className="num mt-1 pl-4 text-sm text-zinc-500">
                {formatDate(purchase.saleDate)}
                {purchase.itemCount !== null ? (
                  <>
                    <span className="mx-1.5 text-zinc-300">·</span>
                    {purchase.itemCount}{" "}
                    {purchase.itemCount === 1 ? "item" : "items"}
                  </>
                ) : null}
                {purchase.detail ? (
                  <>
                    <span className="mx-1.5 text-zinc-300">·</span>
                    {purchase.detail}
                  </>
                ) : null}
              </p>
            </div>
            {/* This is what the sale was WORTH — revenue, not a balance. */}
            <span className="num shrink-0 text-[15px] font-semibold text-zinc-900">
              {formatPKR(purchase.totalAmount)}
            </span>
          </div>
        );

        return href ? (
          <Link
            key={`${purchase.module}-${purchase.id}`}
            href={href}
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            {body}
          </Link>
        ) : (
          <div key={`${purchase.module}-${purchase.id}`}>{body}</div>
        );
      })}
    </div>
  );
}
