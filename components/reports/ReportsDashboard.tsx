"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { LogIn, RefreshCw } from "lucide-react";

import { RevenueTrendChart } from "@/components/reports/RevenueTrendChart";
import { TopProductsChart } from "@/components/reports/TopProductsChart";
import { AnimatedMoney } from "@/components/shared/AnimatedMoney";
import { EmptyState } from "@/components/shared/EmptyState";
import { ExportCsvButton } from "@/components/shared/ExportCsvButton";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { enterUp } from "@/lib/motion";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatLiters, formatPKR, toDateKey } from "@/lib/format";
import {
  useReportBalances,
  useReportSummary,
  useTopProducts,
  useTrend,
} from "@/lib/hooks/use-reports";
import {
  REPORT_PERIODS,
  REPORT_PERIOD_LABELS,
  type ReportPeriod,
  type TrendGrouping,
} from "@/lib/reports";
import { cn } from "@/lib/utils";

/**
 * The reports dashboard.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE COMPUTES A TOTAL
 * ---------------------------------------------------------------------------
 * Every figure comes from `/api/reports/*`, which calls lib/reports.ts, which
 * calls the milk-balance helper. That is what makes "Owed to farmers"
 * identical to the balance sheet — the same calculation, not two that happen
 * to agree today.
 *
 * There is no customer-receivables figure on this screen. Sales are revenue;
 * the app does not track what a customer owes.
 *
 * ---------------------------------------------------------------------------
 * ACCENTS
 * ---------------------------------------------------------------------------
 * The Design System says never mix module accents on one screen. This screen is
 * the deliberate exception: it is *about* comparing the three modules, so blue,
 * amber and emerald here identify data, not decoration. The page chrome stays
 * neutral zinc so the accents only ever appear attached to a module's number.
 */

/**
 * How to bucket the trend for each period.
 *
 * A year bucketed by day would be 365 points crushed into a phone-width chart;
 * by month it reads at a glance. "Today" gets no trend at all — see below.
 */
const TREND_GROUPING: Record<ReportPeriod, TrendGrouping> = {
  today: "day",
  week: "day",
  month: "day",
  year: "month",
};

export function ReportsDashboard() {
  const reduceMotion = useReducedMotion();
  const [period, setPeriod] = useState<ReportPeriod>("month");

  const groupBy = TREND_GROUPING[period];

  const summaryQuery = useReportSummary(period);
  /**
   * Separate query on purpose. These two figures cost six database round trips
   * against the summary's one, so holding the page for them made the whole
   * dashboard as slow as its slowest number. They now stream in behind their
   * own skeletons, and because they are all-time they survive a period change
   * untouched.
   */
  const balancesQuery = useReportBalances();
  const beveragesTrend = useTrend({ module: "beverages", groupBy, period });
  const bakeryTrend = useTrend({ module: "bakery", groupBy, period });
  const milkTrend = useTrend({ module: "milk", groupBy, period });
  const topBeverages = useTopProducts({ module: "beverages", period });
  const topBakery = useTopProducts({ module: "bakery", period });

  const summary = summaryQuery.data;

  // The export buttons scope to the period currently on screen, so what you
  // download is what you are looking at.
  const dateFrom = summary ? toDateKey(new Date(summary.range.start)) : undefined;
  // `range.end` is EXCLUSIVE (the start of the next Karachi day), so the last
  // included day is one before it. Passing `end` itself would export an extra
  // day and the CSV would not match the screen.
  const dateTo = summary
    ? toDateKey(new Date(new Date(summary.range.end).getTime() - 86_400_000))
    : undefined;

  const header = (
    <PageHeader
      title="Reports"
      description="Revenue, trends and exports across all three businesses."
    />
  );

  // ------------------------------------------------------------------
  // Session / error states
  // ------------------------------------------------------------------

  if (
    summaryQuery.error instanceof ApiError &&
    summaryQuery.error.isSessionExpired
  ) {
    return (
      <>
        {header}
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to see your reports."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  if (summaryQuery.error) {
    return (
      <>
        {header}
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load reports"
          description={
            summaryQuery.error instanceof ApiError
              ? summaryQuery.error.message
              : "Something went wrong."
          }
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => summaryQuery.refetch()}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  const loading = summaryQuery.isPending;

  return (
    <>
      {header}

      {/* Period ------------------------------------------------------- */}
      <Tabs
        value={period}
        onValueChange={(next) => setPeriod(next as ReportPeriod)}
        className="mb-4"
      >
        <TabsList className="w-full">
          {REPORT_PERIODS.map((option) => (
            <TabsTrigger key={option} value={option} className="flex-1">
              {REPORT_PERIOD_LABELS[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Stat cards --------------------------------------------------- */}
      <motion.div
        {...enterUp(reduceMotion)}
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <StatCard
          label="Total revenue"
          loading={loading}
          value={summary?.combined.totalRevenue ?? 0}
          tone="text-zinc-900"
          border="border-zinc-200"
          hint="beverages + bakery + milk sold"
          countUp
        />
        <StatCard
          label="Beverages"
          loading={loading}
          value={summary?.beverages.revenue ?? 0}
          tone="text-blue-600"
          border="border-blue-100"
          // Top seller comes from the top-products query this page already
          // makes for its chart. Computing it in the summary too cost four
          // extra database round trips for a value already on screen.
          hint={
            summary
              ? `${summary.beverages.salesCount} ${summary.beverages.salesCount === 1 ? "sale" : "sales"}${topBeverages.data?.[0] ? ` · top: ${topBeverages.data[0].productName}` : ""}`
              : undefined
          }
          countUp
        />
        <StatCard
          label="Bakery"
          loading={loading}
          value={summary?.bakery.revenue ?? 0}
          tone="text-amber-600"
          border="border-amber-100"
          hint={
            summary
              ? `${summary.bakery.salesCount} ${summary.bakery.salesCount === 1 ? "sale" : "sales"}${topBakery.data?.[0] ? ` · top: ${topBakery.data[0].productName}` : ""}`
              : undefined
          }
          countUp
        />
        <StatCard
          label="Milk sold"
          loading={loading}
          value={summary?.milk.milkSalesRevenue ?? 0}
          tone="text-emerald-600"
          border="border-emerald-100"
          hint={
            summary ? `${formatLiters(summary.milk.litersSold)} sold` : undefined
          }
          countUp
        />
        {/* This waits on `balancesQuery`, not on the page. Its own skeleton
            means the rest of the dashboard is usable while the farmer balance
            queries are still running.

            There is deliberately NO "outstanding receivables" tile any more.
            A sale is revenue, not a debt — the app no longer tracks what a
            customer owes. The farmer tile STAYS, because the owner really does
            owe farmers for milk delivered: that is a payable, not a receivable,
            and the two are not symmetric. Removing the receivables half also
            took FOUR queries off every cold dashboard load.

            `failed` is passed separately from `loading` on purpose. This is a
            money tile: if the request fails, `data` is undefined and a naive
            `?? 0` renders a confident "Rs. 0" — telling the owner they owe
            nothing when the truth is simply unknown. A dash and a retry is
            honest; a fabricated zero is not. */}
        <StatCard
          label="Owed to farmers"
          loading={balancesQuery.isPending}
          failed={balancesQuery.isError}
          onRetry={() => balancesQuery.refetch()}
          value={balancesQuery.data?.farmers.totalOwed ?? 0}
          tone="text-emerald-600"
          border="border-emerald-100"
          hint="what you must pay out, all time"
          countUp
        />
      </motion.div>

      {/* Revenue trend ------------------------------------------------ */}
      <section className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-semibold text-zinc-900">Revenue trend</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {groupBy === "month" ? "By month" : "By day"}, in Pakistan time.
        </p>

        <div className="mt-4">
          {period === "today" ? (
            /* One bucket is not a trend. Saying so beats drawing a single dot
               and calling it a chart. */
            <div className="flex h-[140px] items-center justify-center rounded-lg border border-dashed border-zinc-200 px-4 text-center text-sm text-zinc-500">
              A trend needs more than one day — pick This Week, This Month or
              This Year.
            </div>
          ) : beveragesTrend.isPending ||
            bakeryTrend.isPending ||
            milkTrend.isPending ? (
            <Skeleton className="h-[280px] w-full rounded-lg" />
          ) : beveragesTrend.isError ||
            bakeryTrend.isError ||
            milkTrend.isError ? (
            /* An errored trend query would otherwise fall through to the
               chart's empty state and read as "no sales in this period" —
               claiming the business sold nothing when the request simply
               failed. */
            <div className="flex h-[140px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-200 px-4 text-center text-sm text-zinc-500">
              <span>Couldn&apos;t load the trend.</span>
              <button
                type="button"
                onClick={() => {
                  beveragesTrend.refetch();
                  bakeryTrend.refetch();
                  milkTrend.refetch();
                }}
                className="min-h-[44px] font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900"
              >
                Try again
              </button>
            </div>
          ) : (
            <RevenueTrendChart
              beverages={beveragesTrend.data ?? []}
              bakery={bakeryTrend.data ?? []}
              milk={milkTrend.data ?? []}
              groupBy={groupBy}
            />
          )}
        </div>
      </section>

      {/* Top products ------------------------------------------------- */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-semibold text-blue-600">
            Top beverages
          </h2>
          <p className="mt-0.5 mb-3 text-sm text-zinc-500">By revenue</p>
          <TopProductsChart
            products={topBeverages.data ?? []}
            colour="#2563eb"
            isLoading={topBeverages.isPending}
            isError={topBeverages.isError}
            onRetry={() => topBeverages.refetch()}
            emptyMessage="No beverage sales in this period."
          />
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-semibold text-amber-600">Top bakery</h2>
          <p className="mt-0.5 mb-3 text-sm text-zinc-500">By revenue</p>
          <TopProductsChart
            products={topBakery.data ?? []}
            colour="#d97706"
            isLoading={topBakery.isPending}
            isError={topBakery.isError}
            onRetry={() => topBakery.refetch()}
            emptyMessage="No bakery sales in this period."
          />
        </section>
      </div>

      {/* Milk block ---------------------------------------------------
          Milk is the only module with money moving BOTH ways, so it gets a
          block rather than a card: buying and selling shown separately, and
          netted only where netting is meaningful (milk value less the goods
          farmers took against it). */}
      <section className="mb-4 rounded-xl border border-emerald-100 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-semibold text-emerald-600">Milk summary</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          What came in from farmers, and what went out to customers.
        </p>

        {loading ? (
          <Skeleton className="mt-4 h-24 w-full rounded-lg" />
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Figure
              label="Litres received"
              value={formatLiters(summary?.milk.litersReceived ?? 0)}
            />
            <Figure
              label="Milk value"
              value={formatPKR(summary?.milk.milkValue ?? 0)}
            />
            <Figure
              label="Farmer purchases"
              value={`− ${formatPKR(summary?.milk.farmerPurchases ?? 0)}`}
              tone="text-rose-600"
            />
            <Figure
              label="Net milk cost"
              value={formatPKR(summary?.milk.netMilkCost ?? 0)}
              tone="text-zinc-900"
              strong
            />
            <Figure
              label="Litres sold"
              value={formatLiters(summary?.milk.litersSold ?? 0)}
            />
            <Figure
              label="Milk revenue"
              value={formatPKR(summary?.milk.milkSalesRevenue ?? 0)}
              tone="text-emerald-600"
              strong
            />
          </div>
        )}
      </section>

      {/* Exports ------------------------------------------------------ */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-semibold text-zinc-900">Export</h2>
        <p className="mt-0.5 mb-3 text-sm text-zinc-500">
          Sales exports cover{" "}
          <span className="font-medium text-zinc-700">
            {REPORT_PERIOD_LABELS[period].toLowerCase()}
          </span>
          . Balance exports are always a full, current snapshot.
        </p>

        <div className="flex flex-wrap gap-2">
          <ExportCsvButton
            type="beverages_sales"
            dateFrom={dateFrom}
            dateTo={dateTo}
            label="Beverages sales"
          />
          <ExportCsvButton
            type="bakery_sales"
            dateFrom={dateFrom}
            dateTo={dateTo}
            label="Bakery sales"
          />
          <ExportCsvButton
            type="milk_sales"
            dateFrom={dateFrom}
            dateTo={dateTo}
            label="Milk sales"
          />
          <ExportCsvButton
            type="milk_deliveries"
            dateFrom={dateFrom}
            dateTo={dateTo}
            label="Milk deliveries"
          />
          <ExportCsvButton
            type="milk_purchases"
            dateFrom={dateFrom}
            dateTo={dateTo}
            label="Farmer purchases"
          />
          <ExportCsvButton type="farmer_balances" label="Farmer balances" />
          {/* No "Customer balances" export any more. The CSV columns are
              Total billed / Total paid / Outstanding — exactly the figures the
              app stopped tracking, so offering the download would reintroduce
              receivables through the back door and hand the owner a
              spreadsheet the screens contradict. The `customer_balances` case
              in /api/reports/export still exists, unreferenced, alongside
              lib/receivables.ts. */}
        </div>
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  tone,
  border,
  hint,
  loading,
  failed,
  onRetry,
  countUp,
}: {
  label: string;
  value: number;
  tone: string;
  border: string;
  hint?: string;
  loading: boolean;
  /** The query errored — show that, never a stand-in zero. */
  failed?: boolean;
  onRetry?: () => void;
  countUp?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border bg-white p-5 shadow-sm", border)}>
      <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-32 rounded-lg" />
      ) : failed ? (
        <>
          <p className="mt-2 text-[28px] font-bold leading-tight text-zinc-300">
            —
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex min-h-[44px] items-center text-sm font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
          >
            Couldn&apos;t load — retry
          </button>
        </>
      ) : countUp ? (
        <AnimatedMoney
          value={value}
          countUpOnMount
          className={cn("mt-2 block text-[28px] font-bold leading-tight", tone)}
        />
      ) : (
        <p className={cn("num mt-2 text-[28px] font-bold leading-tight", tone)}>
          {formatPKR(value)}
        </p>
      )}
      {hint && !failed ? (
        <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "text-zinc-900",
  strong,
}: {
  label: string;
  value: string;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p
        className={cn(
          "num mt-0.5 text-[15px]",
          strong ? "font-semibold" : "font-medium",
          tone
        )}
      >
        {value}
      </p>
    </div>
  );
}
