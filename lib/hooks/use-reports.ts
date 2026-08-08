"use client";

/**
 * TanStack Query bindings for the reports dashboard.
 *
 * Every money and litre field arriving here is ALREADY A NUMBER — the routes
 * serialize the Decimals at the boundary (Gotcha 2). Nothing in the UI
 * recomputes a total; it renders what lib/reports.ts calculated, which in turn
 * calls the receivables and milk helpers rather than re-deriving them.
 */
import { useQuery } from "@tanstack/react-query";

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
  receivables: { totalOutstanding: number };
  farmers: { totalOwed: number; totalAdvanced: number };
  combined: { totalRevenue: number };
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
  trend: (module: TrendModule, groupBy: TrendGrouping, period: ReportPeriod) =>
    [...reportKeys.all, "trend", module, groupBy, period] as const,
  topProducts: (module: ProductModule, period: ReportPeriod, limit: number) =>
    [...reportKeys.all, "top-products", module, period, limit] as const,
};

export function useReportSummary(period: ReportPeriod) {
  return useQuery({
    queryKey: reportKeys.summary(period),
    queryFn: () =>
      api.get<ReportSummary>(`/api/reports/summary?period=${period}`),
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
