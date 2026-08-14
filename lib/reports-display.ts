/**
 * The CLIENT-SAFE half of reports: periods, groupings, module keys and labels.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS — the same split as milk / receivables
 * ---------------------------------------------------------------------------
 * `lib/reports.ts` imports Prisma, so it is SERVER-ONLY. It also happened to
 * export the handful of constants and types the reports SCREEN needs, which
 * quietly put a Prisma-importing module into the client bundle.
 *
 * That was survivable until S6 added a top-level `Prisma.sql` to that import
 * graph, at which point `/reports` died on hydration with
 * "sqltag is unable to run in this browser environment" — while `tsc`, lint,
 * the production build and every API test stayed green (Gotcha 3b).
 *
 * The immediate crash was fixed by making the SQL lazy. This file fixes the
 * cause: client components import their constants from HERE and never reach the
 * server module at all. It is the pattern `lib/milk-display.ts` and
 * `lib/receivables-display.ts` already follow — dependency-free, no Prisma, safe
 * in a `"use client"` file.
 *
 * `lib/reports.ts` re-exports these so server callers and the API routes are
 * unchanged; there is still ONE definition of each value.
 */

export const REPORT_PERIODS = ["today", "week", "month", "year"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
};

export const TREND_MODULES = ["beverages", "bakery", "milk"] as const;
export type TrendModule = (typeof TREND_MODULES)[number];

export const TREND_GROUPINGS = ["day", "week", "month"] as const;
export type TrendGrouping = (typeof TREND_GROUPINGS)[number];

/**
 * MILK JOINED THIS LIST IN S6. It could not be here before: a `MilkSale` is
 * litres × rate on a single row with no product, so there was nothing to group
 * by. A milk line on the till IS a product line (`prod_milk`, quantity in
 * litres), so milk now answers "how much did I sell" the way the other two do.
 */
export const PRODUCT_MODULES = ["beverages", "bakery", "milk"] as const;
export type ProductModule = (typeof PRODUCT_MODULES)[number];
