"use client";

/**
 * TanStack Query bindings for the milk shop.
 *
 * Every money and litre field arriving here is ALREADY A NUMBER — the routes
 * serialize the Decimals at the boundary (Gotcha 2). Nothing in the UI
 * recomputes a balance; it renders what the server calculated in lib/milk.ts.
 *
 * The global query settings (`networkMode: "always"` plus the 15s timeout in
 * lib/api-client.ts) are what stop a Save button from hanging forever offline.
 * They are set once in components/providers/query-provider.tsx — see the client
 * data-fetching note in CLAUDE.md.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import { customerKeys } from "@/lib/hooks/use-customers";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type Farmer = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
};

/**
 * A farmer's money position.
 *
 * `netBalanceOwed` is POSITIVE when the OWNER OWES THE FARMER — the opposite
 * sign convention from a customer's `outstanding`. Do not test the sign by
 * hand: use the helpers in lib/milk-display.ts, which are client-safe and are
 * the one place that mapping is decided. (lib/milk.ts holds the same logic for
 * the server but imports Prisma, so it must never reach a client component.)
 */
export type FarmerBalance = {
  totalMilkValue: number;
  totalPurchases: number;
  netBalanceOwed: number;
  totalLiters: number;
  lastDeliveryDate: string | null;
  lastPurchaseDate: string | null;
};

export type FarmerWithBalance = Farmer & FarmerBalance;

export type FarmersSummary = {
  farmerCount: number;
  totalMilkValue: number;
  totalPurchases: number;
  totalLiters: number;
  /** Sum of the POSITIVE balances — cash the owner actually has to find. */
  totalOwedToFarmers: number;
  /** Sum of the negative balances, as a positive number. */
  totalAdvanced: number;
};

export type FarmersResponse = {
  farmers: FarmerWithBalance[];
  summary: FarmersSummary | null;
};

/**
 * `morningLiters` / `eveningLiters` are `null` when that session did not happen
 * — which is NOT the same as 0 litres. Render null as an empty cell, never as
 * "0 L". See serializeLiters() in lib/serialize.ts.
 */
export type Delivery = {
  id: string;
  farmerId: string;
  deliveryDate: string;
  morningLiters: number | null;
  eveningLiters: number | null;
  ratePerLiter: number;
  totalLiters: number;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
};

export type FarmerPurchase = {
  id: string;
  farmerId: string;
  purchaseDate: string;
  itemDescription: string;
  amount: number;
  notes: string | null;
  createdAt: string;
};

export type FarmerLedgerEntry = {
  id: string;
  kind: "delivery" | "purchase";
  date: string;
  /** Signed: positive for a delivery, negative for a purchase. */
  amount: number;
  /** Net owed AFTER this entry. */
  runningBalance: number;
  label: string;
  liters: number | null;
};

export type FarmerProfile = {
  farmer: Farmer;
  balance: FarmerBalance;
  deliveries: Delivery[];
  purchases: FarmerPurchase[];
  ledger: FarmerLedgerEntry[];
};

/** One row of the quick-entry grid: a farmer and whatever that day holds. */
export type QuickEntryRow = {
  farmerId: string;
  name: string;
  phone: string | null;
  delivery: Delivery | null;
  /** This farmer's last used rate, so the owner types it once. */
  suggestedRate: number | null;
};

export type QuickEntryDay = {
  deliveryDate: string;
  rows: QuickEntryRow[];
};

export type QuickEntryResult = {
  deliveryDate: string;
  created: number;
  updated: number;
  skipped: number;
  /**
   * Rows the owner blanked out that STILL have a stored delivery. Quick entry
   * never deletes — the UI must tell the owner to remove these explicitly, or
   * they will believe a cleared row was saved as cleared.
   */
  clearedButKept: { farmerId: string; name: string; deliveryId: string }[];
  balances: Record<string, FarmerBalance>;
  summary: FarmersSummary;
};

export type MilkSale = {
  id: string;
  customerId: string;
  saleDate: string;
  liters: number;
  ratePerLiter: number;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  customer: { id: string; name: string; type: string };
};

export type MilkSalesResponse = {
  sales: MilkSale[];
  /** Totals for the WHOLE filtered set, not just the current page. */
  totals: { liters: number; amount: number };
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export type MilkSaleFilters = {
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
};

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const milkKeys = {
  all: ["milk"] as const,
  farmers: (withBalances: boolean) =>
    [...milkKeys.all, "farmers", withBalances] as const,
  farmer: (id: string) => [...milkKeys.all, "farmer", id] as const,
  quickEntry: (date: string) => [...milkKeys.all, "quick-entry", date] as const,
  sales: (filters: MilkSaleFilters) =>
    [...milkKeys.all, "sales", filters] as const,
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Every farmer, with balances by default.
 *
 * `withBalances` is part of the key so the balance-free variant (used by
 * pickers) can never be read as a complete list — the same trap the customers
 * hook guards against.
 */
export function useFarmers(options?: {
  withBalances?: boolean;
  includeInactive?: boolean;
}) {
  const withBalances = options?.withBalances ?? true;
  const includeInactive = options?.includeInactive ?? false;
  return useQuery({
    queryKey: [...milkKeys.farmers(withBalances), includeInactive] as const,
    queryFn: () =>
      api.get<FarmersResponse>(
        `/api/milk/farmers${buildQuery({
          withBalances: withBalances ? undefined : "false",
          includeInactive: includeInactive ? "true" : undefined,
        })}`
      ),
  });
}

/** The profile: farmer, balance, deliveries, purchases and the ledger. */
export function useFarmerProfile(id: string) {
  return useQuery({
    queryKey: milkKeys.farmer(id),
    queryFn: () => api.get<FarmerProfile>(`/api/milk/farmers/${id}`),
    enabled: Boolean(id),
  });
}

/** The quick-entry grid for one Karachi day, prefilled with what's recorded. */
export function useQuickEntryDay(date: string) {
  return useQuery({
    queryKey: milkKeys.quickEntry(date),
    queryFn: () =>
      api.get<QuickEntryDay>(`/api/milk/deliveries/quick-entry?date=${date}`),
    enabled: Boolean(date),
  });
}

export function useMilkSales(filters: MilkSaleFilters = {}) {
  return useQuery({
    queryKey: milkKeys.sales(filters),
    queryFn: () =>
      api.get<MilkSalesResponse>(`/api/milk/sales${buildQuery(filters)}`),
  });
}

// ---------------------------------------------------------------------------
// Mutations
//
// Every write invalidates the WHOLE milk tree rather than the one row it
// touched. A delivery changes that farmer's profile AND their net balance on
// the hub AND the "total owed to farmers" summary above it; invalidating
// narrowly is exactly how a summary bar ends up disagreeing with the list
// underneath it.
//
// MILK SALES ALSO INVALIDATE THE CUSTOMER TREE. `lib/receivables.ts` has summed
// MilkSale since Phase 4b, so selling milk moves a customer's outstanding
// balance too — without this, the customers hub would keep showing a stale
// figure until something else happened to refetch it.
// ---------------------------------------------------------------------------

export function useCreateFarmer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      phone?: string | null;
      address?: string | null;
    }) => api.post<FarmerWithBalance>("/api/milk/farmers", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useUpdateFarmer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      phone?: string | null;
      address?: string | null;
      isActive?: boolean;
    }) => api.patch<Farmer>(`/api/milk/farmers/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useRetireFarmer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{
        deleted: "soft";
        farmer: Farmer;
        netBalanceOwed: number;
        message: string;
      }>(`/api/milk/farmers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useCreateDelivery(farmerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      deliveryDate: string;
      morningLiters?: number | null;
      eveningLiters?: number | null;
      ratePerLiter: number;
      notes?: string | null;
    }) =>
      api.post<{ delivery: Delivery; balance: FarmerBalance }>(
        `/api/milk/farmers/${farmerId}/deliveries`,
        input
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useUpdateDelivery(farmerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deliveryId,
      ...patch
    }: {
      deliveryId: string;
      deliveryDate?: string;
      morningLiters?: number | null;
      eveningLiters?: number | null;
      ratePerLiter?: number;
      notes?: string | null;
    }) =>
      api.patch<{ delivery: Delivery; balance: FarmerBalance }>(
        `/api/milk/farmers/${farmerId}/deliveries/${deliveryId}`,
        patch
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useDeleteDelivery(farmerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) =>
      api.delete<{ deleted: "hard"; id: string; balance: FarmerBalance }>(
        `/api/milk/farmers/${farmerId}/deliveries/${deliveryId}`
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useCreatePurchase(farmerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      purchaseDate: string;
      itemDescription: string;
      amount: number;
      notes?: string | null;
    }) =>
      api.post<{ purchase: FarmerPurchase; balance: FarmerBalance }>(
        `/api/milk/farmers/${farmerId}/purchases`,
        input
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useUpdatePurchase(farmerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      purchaseId,
      ...patch
    }: {
      purchaseId: string;
      purchaseDate?: string;
      itemDescription?: string;
      amount?: number;
      notes?: string | null;
    }) =>
      api.patch<{ purchase: FarmerPurchase; balance: FarmerBalance }>(
        `/api/milk/farmers/${farmerId}/purchases/${purchaseId}`,
        patch
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useDeletePurchase(farmerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (purchaseId: string) =>
      api.delete<{ deleted: "hard"; id: string; balance: FarmerBalance }>(
        `/api/milk/farmers/${farmerId}/purchases/${purchaseId}`
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useSaveQuickEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      deliveryDate: string;
      entries: {
        farmerId: string;
        morningLiters?: number | null;
        eveningLiters?: number | null;
        ratePerLiter: number;
      }[];
    }) =>
      api.post<QuickEntryResult>("/api/milk/deliveries/quick-entry", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milkKeys.all }),
  });
}

export function useCreateMilkSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      customerId: string;
      saleDate: string;
      liters: number;
      ratePerLiter: number;
      notes?: string | null;
    }) =>
      api.post<{ sale: MilkSale; balance: unknown }>("/api/milk/sales", input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: milkKeys.all });
      // A milk sale is a receivable too — see the note above.
      await queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useUpdateMilkSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      saleDate?: string;
      liters?: number;
      ratePerLiter?: number;
      notes?: string | null;
    }) =>
      api.patch<{ sale: MilkSale; balance: unknown }>(
        `/api/milk/sales/${id}`,
        patch
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: milkKeys.all });
      await queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useDeleteMilkSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: "hard"; id: string }>(`/api/milk/sales/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: milkKeys.all });
      await queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}
