"use client";

/**
 * TanStack Query bindings for the UNIFIED sale endpoints (`/api/sales`).
 *
 * ---------------------------------------------------------------------------
 * WHY THESE SIT BESIDE `use-sales.ts` RATHER THAN EXTENDING IT
 * ---------------------------------------------------------------------------
 * `lib/hooks/use-sales.ts` is parameterised by a `SaleModule` and keys its cache
 * `["sales", module.key, …]`. The unified bill has no single module — that is
 * the entire point of it — so it cannot supply that parameter, and its payloads
 * differ in two ways the shared types would have to be loosened to accept:
 *
 *   - a line carries `moduleKey` and `netLineTotal` (unified columns only)
 *   - a row carries `modules[]`, the deduped set of modules on the bill
 *   - NO discounts, at line or bill level (`POST /api/sales` is `.strict()`,
 *     so sending `discountPercent` is a 400, not a silent drop)
 *
 * Keys are `["unified-sales", …]` — a SEPARATE namespace from `["sales", …]`,
 * so the unified list and a per-module list can never serve each other's rows
 * from cache. Same reasoning that put the module segment in the per-module keys
 * in Phase 4.
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
import { catalogKeys } from "@/lib/hooks/use-catalog";
import { customerKeys } from "@/lib/hooks/use-customers";
import { invalidateReports } from "@/lib/hooks/use-reports";
import type { SaleCustomer } from "@/lib/hooks/use-sales";

// ---------------------------------------------------------------------------
// Response shapes (mirror the `select` blocks in the route handlers)
// ---------------------------------------------------------------------------

/** "beverages" | "bakery" | "milk" — a stored snapshot, never re-derived. */
export type UnifiedModuleKey = string;

export type UnifiedSaleListRow = {
  id: string;
  /** ISO-8601 UTC. Bucket/display in Karachi, never by the raw UTC day. */
  saleDate: string;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  customer: SaleCustomer;
  itemCount: number;
  /** Which modules this bill touched, in a stable order. May hold all three. */
  modules: UnifiedModuleKey[];
};

export type UnifiedSaleListResponse = {
  sales: UnifiedSaleListRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export type UnifiedSaleItem = {
  id: string;
  productId: string;
  /** DECIMAL — `12.5` litres of milk is an ordinary quantity (Migration C). */
  quantity: number;
  /** The SNAPSHOT taken when the line was written — not today's catalog price. */
  unitPrice: number;
  /** Always 0 on this endpoint: the unified sale has no discounts. */
  discountPercent: number;
  lineTotal: number;
  /** What this line was SOLD AS. Snapshotted; reports group by it. */
  moduleKey: UnifiedModuleKey;
  /** The line's contribution to the bill total. Equals `lineTotal` (no discounts). */
  netLineTotal: number;
  product: {
    id: string;
    name: string;
    size: string | null;
    qualityTier: string | null;
    shape: string | null;
    /** "litre" for milk, "cotton" for eggs. Drives the quantity wording. */
    unit: string | null;
    isActive: boolean;
  };
};

export type UnifiedSaleDetail = {
  id: string;
  saleDate: string;
  discountPercent: number;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  customer: SaleCustomer;
  items: UnifiedSaleItem[];
};

/**
 * The create payload. **No discount fields anywhere** — the endpoint's schema is
 * `.strict()`, so adding one here would turn every save into a 400.
 */
export type UnifiedSaleCreateInput = {
  customerId: string;
  /** `yyyy-MM-dd`, read as a Karachi calendar day by the server. */
  saleDate: string;
  notes?: string;
  items: {
    productId: string;
    /** May be fractional — litres. */
    quantity: number;
    /** Create-only price override; the server snapshots it verbatim. */
    unitPrice?: number;
  }[];
};

export type UnifiedSaleListFilters = {
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  limit: number;
};

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const unifiedSaleKeys = {
  all: ["unified-sales"] as const,
  list: (filters: UnifiedSaleListFilters) =>
    [...unifiedSaleKeys.all, "list", filters] as const,
  detail: (id: string) => [...unifiedSaleKeys.all, "detail", id] as const,
};

/**
 * Everything a unified sale changes.
 *
 * Four caches, not one. A bill moves the sales list, the REPORTS dashboard, that
 * CUSTOMER's outstanding balance — and, unlike the per-module hooks, **the
 * CATALOG**, because every line decrements `Product.stock` and the catalog is
 * where the owner reads it. Leaving catalog stale is how a screen shows 100 in
 * stock for a product a sale just took 12.5 of.
 *
 * Queries that aren't mounted are merely MARKED stale rather than refetched, so
 * this costs nothing while the owner is still on the till.
 */
function invalidateAfterUnifiedSale(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: unifiedSaleKeys.all }),
    invalidateReports(queryClient),
    queryClient.invalidateQueries({ queryKey: customerKeys.all }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
  ]);
}

function buildQuery(filters: UnifiedSaleListFilters): string {
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

export function useUnifiedSales(
  filters: UnifiedSaleListFilters,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: unifiedSaleKeys.list(filters),
    queryFn: () =>
      api.get<UnifiedSaleListResponse>(`/api/sales?${buildQuery(filters)}`),
    // Keeps the current page on screen while the next loads, instead of
    // flashing back to skeletons on every filter or page change.
    placeholderData: (previous) => previous,
    enabled: options?.enabled ?? true,
  });
}

/**
 * One bill with its lines. Only fetched when a row is expanded — the list
 * response carries a count, not the lines, so the table stays light.
 */
export function useUnifiedSale(id: string | null) {
  return useQuery({
    queryKey: unifiedSaleKeys.detail(id ?? ""),
    queryFn: () => api.get<UnifiedSaleDetail>(`/api/sales/${id}`),
    enabled: id !== null,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateUnifiedSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UnifiedSaleCreateInput) =>
      api.post<UnifiedSaleDetail>("/api/sales", input),
    onSuccess: () => invalidateAfterUnifiedSale(queryClient),
  });
}

/** Deleting a unified sale RESTORES its stock, server-side and in one transaction. */
export function useDeleteUnifiedSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: "hard"; id: string; itemCount: number }>(
        `/api/sales/${id}`
      ),
    onSuccess: () => invalidateAfterUnifiedSale(queryClient),
  });
}
