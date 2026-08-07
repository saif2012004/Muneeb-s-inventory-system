"use client";

/**
 * TanStack Query bindings for the sale routes of ANY module.
 *
 * Generalised from the beverages-only hooks in Phase 3. Both modules' endpoints
 * return the same shapes, so one set of hooks serves both — parameterised by
 * the SaleModule, which supplies the base path and scopes the query keys.
 *
 * Every money field arriving here is ALREADY A NUMBER — the routes serialize the
 * Prisma Decimals at the boundary (Gotcha 2). Nothing here recomputes a stored
 * total; it renders what the server sent.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { SaleModule } from "@/lib/sale-modules";
import type { CustomerType } from "@/lib/validations/customers";

// ---------------------------------------------------------------------------
// Response shapes (mirror the `select` blocks in the route handlers)
// ---------------------------------------------------------------------------

export type SaleCustomer = {
  id: string;
  name: string;
  phone?: string | null;
  type: CustomerType;
};

export type SaleListRow = {
  id: string;
  /** ISO-8601 UTC. Bucket/display in Karachi, never by the raw UTC day. */
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
    /** Bakery: "premium" | "simple". Null on beverages. */
    qualityTier: string | null;
    /** Russ: "circle" | "rectangular_round". Null elsewhere. */
    shape: string | null;
    discountPercent: number | null;
    /** "cotton" for eggs, "piece", "bottle". Drives the quantity wording. */
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
// Query keys — scoped by module so beverages and bakery never share a cache
// entry. Without the module segment, opening one list would show the other's
// rows from cache until the refetch landed.
// ---------------------------------------------------------------------------

export const saleKeys = {
  module: (module: SaleModule) => ["sales", module.key] as const,
  list: (module: SaleModule, filters: SaleListFilters) =>
    [...saleKeys.module(module), "list", filters] as const,
  detail: (module: SaleModule, id: string) =>
    [...saleKeys.module(module), "detail", id] as const,
};

function invalidateModule(queryClient: QueryClient, module: SaleModule) {
  return queryClient.invalidateQueries({ queryKey: saleKeys.module(module) });
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

export function useSales(
  module: SaleModule,
  filters: SaleListFilters,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: saleKeys.list(module, filters),
    queryFn: () =>
      api.get<SaleListResponse>(`${module.apiBase}?${buildQuery(filters)}`),
    // Keeps the current page on screen while the next loads, instead of
    // flashing back to skeletons on every filter or page change.
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
export function useSale(module: SaleModule, id: string | null) {
  return useQuery({
    queryKey: saleKeys.detail(module, id ?? ""),
    queryFn: () => api.get<SaleDetail>(`${module.apiBase}/${id}`),
    enabled: id !== null,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateSale(module: SaleModule) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaleCreateInput) =>
      api.post<SaleDetail>(module.apiBase, input),
    onSuccess: () => invalidateModule(queryClient, module),
  });
}

export function useDeleteSale(module: SaleModule) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: "hard"; id: string; itemCount: number }>(
        `${module.apiBase}/${id}`
      ),
    onSuccess: () => invalidateModule(queryClient, module),
  });
}
