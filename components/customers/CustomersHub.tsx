"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { LogIn, Plus, RefreshCw, Search, Users, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { CustomerDialog } from "@/components/customers/CustomerDialog";
import { AnimatedMoney } from "@/components/shared/AnimatedMoney";
import { EmptyState } from "@/components/shared/EmptyState";
import { MoneyText } from "@/components/shared/MoneyText";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatPKR } from "@/lib/format";
import {
  useCreateCustomer,
  useCustomers,
  type CustomerWithBalance,
} from "@/lib/hooks/use-customers";
import {
  BALANCE_TEXT_CLASS,
  balanceLabel,
  balanceMagnitude,
  balanceMoneyTone,
  balanceTone,
} from "@/lib/receivables-display";
import { cn } from "@/lib/utils";
import { CUSTOMER_TYPE_LABELS } from "@/lib/validations/customers";

/**
 * The customers hub. Its one job is answering "who owes me money", so the
 * default sort is by outstanding, biggest debtor first — not alphabetical.
 * Alphabetical is what a contact list does; this is a receivables ledger.
 *
 * Every figure shown comes from the server's calculation (lib/receivables.ts).
 * Nothing here derives a balance, including the summary total.
 */
export function CustomersHub() {
  const reduceMotion = useReducedMotion();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const customersQuery = useCustomers({ withBalances: true });
  const createCustomer = useCreateCustomer();

  const customers = useMemo(() => customersQuery.data ?? [], [customersQuery.data]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? customers.filter(
          (customer) =>
            customer.name.toLowerCase().includes(term) ||
            (customer.phone ?? "").toLowerCase().includes(term)
        )
      : customers;

    // Biggest debtor first; ties broken by name so the order is stable.
    return [...filtered].sort((a, b) => {
      if (b.outstanding !== a.outstanding) return b.outstanding - a.outstanding;
      return a.name.localeCompare(b.name);
    });
  }, [customers, search]);

  /**
   * The headline number: what the whole book is owed.
   *
   * Summing the per-customer outstandings is safe here — they are already
   * numbers the server calculated, not Decimals, and this is a display total
   * over a list already in memory rather than a balance being derived from raw
   * rows in the browser.
   *
   * Customers in CREDIT are excluded deliberately. "Total outstanding" means
   * money the owner is owed; letting one customer's Rs. 500 credit cancel
   * another's Rs. 500 debt would report Rs. 0 owed while someone still owes
   * Rs. 500. The credit total is shown separately.
   */
  const totals = useMemo(() => {
    let owed = 0;
    let credit = 0;
    let owingCount = 0;
    for (const customer of customers) {
      if (customer.outstanding > 0) {
        owed += customer.outstanding;
        owingCount += 1;
      } else if (customer.outstanding < 0) {
        credit += -customer.outstanding;
      }
    }
    return { owed, credit, owingCount };
  }, [customers]);

  const header = (
    <PageHeader
      title="Customers"
      description="Who owes you money, across beverages, bakery and milk."
      action={
        <Button className="h-11 rounded-lg" onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 size-4" aria-hidden />
          Add customer
        </Button>
      }
    />
  );

  // ------------------------------------------------------------------
  // Session / error states
  // ------------------------------------------------------------------

  if (
    customersQuery.error instanceof ApiError &&
    customersQuery.error.isSessionExpired
  ) {
    return (
      <>
        {header}
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to see your customers."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  if (customersQuery.error) {
    return (
      <>
        {header}
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load customers"
          description={
            customersQuery.error instanceof ApiError
              ? customersQuery.error.message
              : "Something went wrong."
          }
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => customersQuery.refetch()}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}

      {/* Summary bar -------------------------------------------------- */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className="mb-4 grid gap-3 sm:grid-cols-3"
      >
        <div className="rounded-xl border border-rose-100 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            Total outstanding
          </p>
          {customersQuery.isPending ? (
            <Skeleton className="mt-3 h-9 w-32 rounded-lg" />
          ) : (
            <AnimatedMoney
              value={totals.owed}
              // A summary tile, fetched once — so it counts up from 0 rather
              // than appearing at its final value.
              countUpOnMount
              className="mt-2 block text-[28px] font-bold leading-tight text-rose-600"
            />
          )}
          <p className="num mt-1 text-sm text-zinc-500">
            {totals.owingCount} {totals.owingCount === 1 ? "customer" : "customers"} owing
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            Customers
          </p>
          {customersQuery.isPending ? (
            <Skeleton className="mt-3 h-9 w-16 rounded-lg" />
          ) : (
            <p className="num mt-2 text-[28px] font-bold leading-tight text-zinc-900">
              {customers.length}
            </p>
          )}
          <p className="mt-1 text-sm text-zinc-500">active</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            In credit
          </p>
          {customersQuery.isPending ? (
            <Skeleton className="mt-3 h-9 w-24 rounded-lg" />
          ) : (
            <p className="num mt-2 text-[28px] font-bold leading-tight text-emerald-600">
              {formatPKR(totals.credit)}
            </p>
          )}
          <p className="mt-1 text-sm text-zinc-500">paid ahead</p>
        </div>
      </motion.div>

      {/* Search ------------------------------------------------------- */}
      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or phone…"
          className="h-11 rounded-lg pl-9"
          autoComplete="off"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Clear search</span>
          </button>
        ) : null}
      </div>

      {/* List --------------------------------------------------------- */}
      {customersQuery.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[88px] w-full rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={
            search ? "No customers match that search" : "No customers yet"
          }
          description={
            search
              ? "Try a different name or phone number."
              : "Add your first customer to start tracking who owes you."
          }
          action={
            search ? (
              <Button
                variant="outline"
                className="h-11 rounded-lg"
                onClick={() => setSearch("")}
              >
                Clear search
              </Button>
            ) : (
              <Button className="h-11 rounded-lg" onClick={() => setAddOpen(true)}>
                <Plus className="mr-2 size-4" aria-hidden />
                Add customer
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((customer) => (
            <CustomerCard key={customer.id} customer={customer} />
          ))}
        </div>
      )}

      <CustomerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="create"
        isPending={createCustomer.isPending}
        onSubmit={(values) =>
          createCustomer.mutate(values, {
            onSuccess: (created) => {
              toast.success(`${created.name} added`);
              setAddOpen(false);
            },
            onError: (error) => {
              if (error instanceof ApiError && error.isSessionExpired) {
                toast.error(error.message);
                redirectToLogin();
                return;
              }
              toast.error(
                error instanceof ApiError
                  ? error.message
                  : "Couldn't add the customer."
              );
            },
          })
        }
      />
    </>
  );
}

/** One customer row. A card at every width — money must never scroll out of view. */
function CustomerCard({ customer }: { customer: CustomerWithBalance }) {
  const tone = balanceTone(customer.outstanding);

  // The most recent thing that happened, either side of the ledger.
  const lastActivity = [customer.lastSaleDate, customer.lastPaymentDate]
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  return (
    <Link
      href={`/customers/${customer.id}`}
      className="block rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:bg-zinc-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-medium text-zinc-900">
              {customer.name}
            </p>
            <Badge
              variant="secondary"
              className="shrink-0 rounded-md text-[11px] font-medium"
            >
              {CUSTOMER_TYPE_LABELS[customer.type]}
            </Badge>
          </div>
          <p className="num mt-1 text-sm text-zinc-500">
            {customer.phone ? (
              <>
                {customer.phone}
                <span className="mx-1.5 text-zinc-300">·</span>
              </>
            ) : null}
            {lastActivity ? `Last activity ${formatDate(lastActivity)}` : "No activity yet"}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <MoneyText
            value={balanceMagnitude(customer.outstanding)}
            tone={balanceMoneyTone(customer.outstanding)}
            className="text-[17px] font-semibold"
          />
          <p className={cn("mt-0.5 text-xs", BALANCE_TEXT_CLASS[tone])}>
            {balanceLabel(customer.outstanding)}
          </p>
        </div>
      </div>
    </Link>
  );
}
