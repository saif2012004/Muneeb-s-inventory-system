"use client";

/**
 * TanStack Query bindings for the customers hub and the receivables ledger.
 *
 * Every money field arriving here is ALREADY A NUMBER — the routes serialize
 * the Decimals at the boundary (Gotcha 2). Nothing in the UI recomputes a
 * balance; it renders what the server calculated in lib/receivables.ts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type {
  CustomerType,
  PaymentMethod,
} from "@/lib/validations/customers";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  type: CustomerType;
  isActive: boolean;
  createdAt: string;
};

/** A customer row on the hub, carrying its computed balance. */
export type CustomerWithBalance = Customer & {
  totalBilled: number;
  totalPaid: number;
  /** billed − paid. Positive = they owe the owner. */
  outstanding: number;
  lastSaleDate: string | null;
  lastPaymentDate: string | null;
};

export type CustomerBalance = {
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  lastSaleDate: string | null;
  lastPaymentDate: string | null;
};

export type Payment = {
  id: string;
  customerId: string;
  paymentDate: string;
  amount: number;
  method: PaymentMethod | null;
  notes: string | null;
  createdAt: string;
};

export type Purchase = {
  id: string;
  module: "beverages" | "bakery" | "milk";
  saleDate: string;
  totalAmount: number;
  notes: string | null;
  itemCount: number | null;
  detail: string | null;
};

export type LedgerEntry = {
  id: string;
  kind: "sale" | "payment";
  module: "beverages" | "bakery" | "milk" | null;
  date: string;
  /** Signed: positive for a sale, negative for a payment. */
  amount: number;
  /** Outstanding AFTER this entry. */
  runningBalance: number;
  label: string;
  itemCount: number | null;
};

/**
 * What /api/customers/[id] returns now: the customer and what they bought.
 *
 * `balance`, `payments` and `ledger` were removed when sales became
 * revenue-only. The `Payment`, `CustomerBalance` and `LedgerEntry` types above
 * are deliberately KEPT even though nothing reads them — they describe the
 * dormant `CustomerPayment` table and lib/receivables.ts, and deleting them
 * would make restoring receivables a rewrite rather than a re-wire.
 */
export type CustomerProfile = {
  customer: Customer;
  purchases: Purchase[];
};

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const customerKeys = {
  all: ["customers"] as const,
  list: (withBalances: boolean) =>
    [...customerKeys.all, "list", withBalances] as const,
  profile: (id: string) => [...customerKeys.all, "profile", id] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Every active customer.
 *
 * `withBalances` is false for the sale-form picker, which only needs names —
 * four aggregate queries to render a dropdown would be waste. The hub passes
 * true. The flag is part of the query key so the two never share a cache entry
 * and the picker can't accidentally read a balance-less list as complete.
 */
export function useCustomers(options?: {
  withBalances?: boolean;
  /**
   * Include deactivated customers. Needed wherever money is TOTALLED:
   * deactivating a customer retires them from new sales, it does not settle
   * their bill, so a receivables total that omitted them would understate what
   * is owed. Same rule as retired farmers on the milk side.
   */
  includeInactive?: boolean;
}) {
  const withBalances = options?.withBalances ?? false;
  const includeInactive = options?.includeInactive ?? false;
  const params = new URLSearchParams();
  if (!withBalances) params.set("withBalances", "false");
  if (includeInactive) params.set("includeInactive", "true");
  const query = params.toString();

  return useQuery({
    queryKey: [...customerKeys.list(withBalances), includeInactive] as const,
    queryFn: () =>
      api.get<CustomerWithBalance[]>(
        `/api/customers${query ? `?${query}` : ""}`
      ),
  });
}

/** The profile: customer, balance, purchases, payments and the ledger. */
export function useCustomerProfile(id: string) {
  return useQuery({
    queryKey: customerKeys.profile(id),
    queryFn: () => api.get<CustomerProfile>(`/api/customers/${id}`),
  });
}

// ---------------------------------------------------------------------------
// Mutations
//
// Every write invalidates the WHOLE customers tree, not just the row it
// touched: a payment changes that customer's profile AND their outstanding on
// the hub AND the total across all customers. Invalidating narrowly is how the
// summary bar ends up disagreeing with the list below it.
// ---------------------------------------------------------------------------

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      phone?: string | null;
      type: CustomerType;
    }) => api.post<CustomerWithBalance>("/api/customers", input),
    onSuccess: (created) => {
      // Seed both list variants so a picker opened straight after adding can
      // select the new customer without waiting for the refetch.
      for (const withBalances of [true, false]) {
        queryClient.setQueryData<CustomerWithBalance[]>(
          customerKeys.list(withBalances),
          (current) => (current ? [...current, created] : [created])
        );
      }
      return queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      phone?: string | null;
      type?: CustomerType;
      isActive?: boolean;
    }) => api.patch<Customer>(`/api/customers/${id}`, patch),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

export function useDeactivateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{
        deleted: "soft";
        customer: Customer;
        outstanding: number;
        message: string;
      }>(`/api/customers/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

export function useCreatePayment(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      paymentDate: string;
      amount: number;
      method?: PaymentMethod | null;
      notes?: string | null;
    }) =>
      api.post<{ payment: Payment; balance: CustomerBalance }>(
        `/api/customers/${customerId}/payments`,
        input
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

export function useUpdatePayment(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      paymentId,
      ...patch
    }: {
      paymentId: string;
      paymentDate?: string;
      amount?: number;
      method?: PaymentMethod | null;
      notes?: string | null;
    }) =>
      api.patch<{ payment: Payment; balance: CustomerBalance }>(
        `/api/customers/${customerId}/payments/${paymentId}`,
        patch
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

export function useDeletePayment(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) =>
      api.delete<{ deleted: "hard"; id: string; balance: CustomerBalance }>(
        `/api/customers/${customerId}/payments/${paymentId}`
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
}
