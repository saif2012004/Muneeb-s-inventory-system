"use client";

/**
 * TanStack Query bindings for the reports dashboard.
 *
 * Every money and litre field arriving here is ALREADY A NUMBER — the routes
 * serialize the Decimals at the boundary (Gotcha 2). Nothing in the UI
 * recomputes a total; it renders what lib/reports.ts calculated, which in turn
 * calls the receivables and milk helpers rather than re-deriving them.
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type {
  ProductModule,
  ReportPeriod,
  TrendGrouping,
  TrendModule,
} from "@/lib/reports";

export type ReportSummary = {
  period: ReportPeriod;
  range: { start: string; end: string };
  beverages: { salesCount: number; revenue: number; topProduct: string | null };
  bakery: { salesCount: number; revenue: number; topProduct: string | null };
  milk: {
    litersReceived: number;
    milkValue: number;
    farmerPurchases: number;
    netMilkCost: number;
    litersSold: number;
    milkSalesRevenue: number;
  };
  combined: { totalRevenue: number };
};

/**
 * The all-time FARMER balances, fetched separately from the period flows.
 *
 * Was six database queries (four for customer receivables, two for farmers);
 * the receivables half was removed when sales became revenue-only, so it is now
 * TWO. It keeps its own request and skeleton anyway: it is still slower than the
 * summary, and it is all-time, so it survives a period change untouched.
 */
export type BalanceTotals = {
  farmers: { totalOwed: number; totalAdvanced: number };
};

export type TrendPoint = { period: string; revenue: number; count: number };

export type TopProduct = {
  productId: string;
  productName: string;
  quantity: number;
  revenue: number;
};

export const reportKeys = {
  all: ["reports"] as const,
  summary: (period: ReportPeriod) =>
    [...reportKeys.all, "summary", period] as const,
  /**
   * NO period segment — these balances are all-time, so switching period tabs
   * reuses the cached value instead of re-running six queries.
   */
  balances: () => [...reportKeys.all, "balances"] as const,
  trend: (module: TrendModule, groupBy: TrendGrouping, period: ReportPeriod) =>
    [...reportKeys.all, "trend", module, groupBy, period] as const,
  topProducts: (module: ProductModule, period: ReportPeriod, limit: number) =>
    [...reportKeys.all, "top-products", module, period, limit] as const,
};

/**
 * Mark every reports query stale after something changed the underlying money.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The dashboard was not updating after a sale. The sale mutations invalidated
 * only their own module's list, so `/reports` kept serving whatever TanStack
 * Query had cached — the owner recorded a sale, opened Reports, and saw the old
 * totals until they hard-reloaded.
 *
 * Invalidating the ROOT key (`["reports"]`) covers summary, trend, top-products
 * and balances in one call, and keeps working when a new reports query is added
 * later. Every mutation that moves a figure the dashboard shows must call this.
 *
 * Invalidation is cheap when the user is elsewhere: queries that are not
 * currently mounted are only MARKED stale, not refetched, so recording a sale
 * does not fire six balance queries in the background — they run when the
 * dashboard is next opened.
 */
export function invalidateReports(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: reportKeys.all });
}

export function useReportSummary(period: ReportPeriod) {
  return useQuery({
    queryKey: reportKeys.summary(period),
    queryFn: () =>
      api.get<ReportSummary>(`/api/reports/summary?period=${period}`),
  });
}

/**
 * The slow half. Deliberately its own query so the dashboard can paint without
 * it, and deliberately not keyed on period so tab switches are free.
 */
export function useReportBalances() {
  return useQuery({
    queryKey: reportKeys.balances(),
    queryFn: () => api.get<BalanceTotals>("/api/reports/balances"),
  });
}

export function useTrend(options: {
  module: TrendModule;
  groupBy: TrendGrouping;
  period: ReportPeriod;
}) {
  const { module, groupBy, period } = options;
  return useQuery({
    queryKey: reportKeys.trend(module, groupBy, period),
    queryFn: () =>
      api.get<TrendPoint[]>(
        `/api/reports/trend?module=${module}&groupBy=${groupBy}&period=${period}`
      ),
  });
}

export function useTopProducts(options: {
  module: ProductModule;
  period: ReportPeriod;
  limit?: number;
}) {
  const { module, period, limit = 5 } = options;
  return useQuery({
    queryKey: reportKeys.topProducts(module, period, limit),
    queryFn: () =>
      api.get<TopProduct[]>(
        `/api/reports/top-products?module=${module}&period=${period}&limit=${limit}`
      ),
  });
}
