"use client";

import { useMemo, useState } from "react";
import { LogIn, Plus, RefreshCw, Search, Users, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { CustomerDialog } from "@/components/customers/CustomerDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import {
  useCreateCustomer,
  useCustomers,
  type Customer,
} from "@/lib/hooks/use-customers";
import { CUSTOMER_TYPE_LABELS } from "@/lib/validations/customers";

/**
 * The customers DIRECTORY.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NO LONGER A DEBTORS LIST
 * ---------------------------------------------------------------------------
 * It used to exist to answer "who owes me money", and everything about it was
 * shaped by that: it sorted by outstanding balance so the biggest debtor sat on
 * top, it carried a "total outstanding" headline, and it deliberately pulled in
 * deactivated customers so their unpaid balances still counted.
 *
 * None of that applies now. A sale is revenue, not a debt — the app does not
 * track what a customer owes. So this is a contact list: who you sell to, how to
 * reach them, and a way through to what they have bought.
 *
 * Three consequences follow, and they are all deliberate:
 *
 *  1. Sorted ALPHABETICALLY. Sorting by balance was right for a ledger and is
 *     meaningless for a directory; a contact list you scan by name must be in
 *     name order.
 *  2. `withBalances: false`. This is not just tidiness — it takes the request
 *     from FIVE database queries to ONE. Measured against the live database:
 *     5.6s -> 1.0s. The four aggregate queries existed solely to compute
 *     balances nothing renders any more.
 *  3. Active only, with no `includeInactive`. That flag existed so retired
 *     customers' debts still counted toward the total. There is no total and no
 *     debt, so the list is simply the people you currently sell to.
 *
 * lib/receivables.ts is untouched and still works. Nothing here calls it.
 */
export function CustomersHub() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const customersQuery = useCustomers();
  const createCustomer = useCreateCustomer();

  const customers = useMemo(
    () => customersQuery.data ?? [],
    [customersQuery.data]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? customers.filter(
          (customer) =>
            customer.name.toLowerCase().includes(term) ||
            (customer.phone ?? "").toLowerCase().includes(term)
        )
      : customers;

    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, search]);

  const header = (
    <PageHeader
      title="Customers"
      description="Everyone you sell to, across beverages, bakery and milk."
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

      {/* Count -------------------------------------------------------- */}
      {customersQuery.isPending ? null : (
        <p className="num mb-3 text-sm text-zinc-500">
          {/* Counts what is ON SCREEN, not what was fetched — a "12 customers"
              line above 3 search results reads as a bug. */}
          {visible.length} {visible.length === 1 ? "customer" : "customers"}
          {search ? " match" : ""}
        </p>
      )}

      {/* List --------------------------------------------------------- */}
      {customersQuery.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[72px] w-full rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={search ? "No customers match that search" : "No customers yet"}
          description={
            search
              ? "Try a different name or phone number."
              : "Add your first customer to start recording sales against them."
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
              <Button
                className="h-11 rounded-lg"
                onClick={() => setAddOpen(true)}
              >
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

/**
 * One directory row: name, what kind of customer, how to reach them.
 *
 * No money. Deliberately — the whole point of the change is that a customer
 * carries no balance. What they bought lives on their profile.
 */
function CustomerCard({ customer }: { customer: Customer }) {
  return (
    <Link
      href={`/customers/${customer.id}`}
      className="block rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:bg-zinc-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
    >
      <div className="flex items-center justify-between gap-3">
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
            {customer.phone ?? "No phone number"}
          </p>
        </div>

        <span className="shrink-0 text-sm font-medium text-zinc-400">
          View →
        </span>
      </div>
    </Link>
  );
}
