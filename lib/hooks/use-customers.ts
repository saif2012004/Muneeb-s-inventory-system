"use client";

/**
 * TanStack Query bindings for the minimal customer routes added in 3.1.
 * Customers are shared across beverages, bakery and milk, so this is not
 * namespaced under a module. The full customers hub is Phase 4b.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { CustomerType } from "@/lib/validations/customers";

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  type: CustomerType;
  isActive: boolean;
};

export const customerKeys = {
  all: ["customers"] as const,
  list: () => [...customerKeys.all, "list"] as const,
};

/**
 * Every active customer, fetched once and searched client-side by the combobox.
 * A shop has tens of customers, not thousands — filtering in the browser keeps
 * the picker instant with no keystroke round-trips.
 */
export function useCustomers() {
  return useQuery({
    queryKey: customerKeys.list(),
    queryFn: () => api.get<Customer[]>("/api/customers"),
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; phone?: string | null; type: CustomerType }) =>
      api.post<Customer>("/api/customers", input),
    onSuccess: (created) => {
      // Seed the new row straight into the cache so the combobox can select it
      // immediately, then revalidate. Without this the owner adds a customer
      // and watches an empty picker until the refetch lands.
      queryClient.setQueryData<Customer[]>(customerKeys.list(), (current) =>
        current ? [...current, created] : [created]
      );
      return queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}
