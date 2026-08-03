"use client";

/**
 * TanStack Query bindings for the Phase 3.1 beverage sale routes.
 *
 * Every money field arriving here is ALREADY A NUMBER — the routes serialize
 * the Prisma Decimals at the boundary (Gotcha 2). Nothing in the UI recomputes
 * a stored total; it renders what the server sent.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { CustomerType } from "@/lib/validations/customers";

// ---------------------------------------------------------------------------
// Response shapes (mirror the `select` blocks in the 3.1 routes)
// ---------------------------------------------------------------------------

export type SaleCustomer = {
  id: string;
  name: string;
  phone?: string | null;
  type: CustomerType;
};

export type SaleListRow = {
  id: string;
  /** ISO-8601 UTC. Bucket/display it in Karachi, never with the raw UTC day. */
  saleDate: string;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  customer: SaleCustomer;
  itemCount: number;
};

export type SaleListResponse = {
  sales: SaleListRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export type SaleItem = {
  id: string;
  productId: string;
  quantity: number;
  /** The SNAPSHOT taken when the line was written — not today's catalog price. */
  unitPrice: number;
  lineTotal: number;
  product: {
    id: string;
    name: string;
    size: string | null;
    discountPercent: number | null;
    unit: string | null;
    isActive: boolean;
  };
};

export type SaleDetail = {
  id: string;
  saleDate: string;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  customer: SaleCustomer;
  items: SaleItem[];
};

export type SaleCreateInput = {
  customerId: string;
  /** `yyyy-MM-dd`, read as a Karachi calendar day by the server. */
  saleDate: string;
  notes?: string;
  items: { productId: string; quantity: number; unitPrice?: number }[];
};

export type SaleListFilters = {
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  limit: number;
};

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const beverageSaleKeys = {
  all: ["beverage-sales"] as const,
  list: (filters: SaleListFilters) =>
    [...beverageSaleKeys.all, "list", filters] as const,
  detail: (id: string) => [...beverageSaleKeys.all, "detail", id] as const,
};

function invalidateSales(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: beverageSaleKeys.all });
}

function buildQuery(filters: SaleListFilters): string {
  const params = new URLSearchParams();
  if (filters.customerId) params.set("customerId", filters.customerId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  params.set("page", String(filters.page));
  params.set("limit", String(filters.limit));
  return params.toString();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useBeverageSales(
  filters: SaleListFilters,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: beverageSaleKeys.list(filters),
    queryFn: () =>
      api.get<SaleListResponse>(`/api/beverages/sales?${buildQuery(filters)}`),
    // Keeps the current page on screen while the next one loads, instead of
    // flashing back to skeletons every time a filter or page changes.
    placeholderData: (previous) => previous,
    // The caller can suppress a request it already knows is invalid — e.g. a
    // date range whose start is after its end.
    enabled: options?.enabled ?? true,
  });
}

/**
 * One sale with its line items. Only fetched when a row is expanded — the list
 * response carries a count, not the lines, so the table stays light.
 */
export function useBeverageSale(id: string | null) {
  return useQuery({
    queryKey: beverageSaleKeys.detail(id ?? ""),
    queryFn: () => api.get<SaleDetail>(`/api/beverages/sales/${id}`),
    enabled: id !== null,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateBeverageSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaleCreateInput) =>
      api.post<SaleDetail>("/api/beverages/sales", input),
    onSuccess: () => invalidateSales(queryClient),
  });
}

export function useDeleteBeverageSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: "hard"; id: string; itemCount: number }>(
        `/api/beverages/sales/${id}`
      ),
    onSuccess: () => invalidateSales(queryClient),
  });
}
