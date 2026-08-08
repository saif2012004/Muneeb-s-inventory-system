"use client";

import {
  BarChart3,
  GlassWater,
  LogIn,
  Milk,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatLiters } from "@/lib/format";
import { useReportSummary } from "@/lib/hooks/use-reports";

/**
 * The app root: how today is going.
 *
 * ---------------------------------------------------------------------------
 * THIS USED TO BE THREE HARDCODED ZEROS
 * ---------------------------------------------------------------------------
 * `/` shipped in Phase 1 as a placeholder with `value={0}` on all three cards
 * and a comment promising real aggregates in Phase 7. Phase 7 built them on
 * `/reports` and nobody came back here, so the first screen the owner sees
 * after signing in confidently reported that they had sold nothing — for six
 * phases. That is worse than an empty state: an empty state admits it has no
 * data, a fake zero asserts a fact.
 *
 * To be exact about what changed: a Rs. 0 here is now *earned*. If the owner
 * genuinely has not sold anything today the cards do read zero, and that is
 * true and useful. The problem was never the digit, it was that it was a
 * constant.
 *
 * ---------------------------------------------------------------------------
 * WHY "TODAY" AND WHY NOT JUST REDIRECT TO /reports
 * ---------------------------------------------------------------------------
 * Redirecting was the cheaper option and was rejected: "Dashboard" and
 * "Reports" are two separate items in the sidebar and the bottom nav, and
 * having both land on the same screen makes one of them a lie of a different
 * kind. They now answer different questions — this one is "what has happened
 * today", /reports is "how is the business doing over a period".
 *
 * It costs ONE database query. `useReportSummary("today")` hits the existing
 * /api/reports/summary, which is a single statement, and this page deliberately
 * does NOT fetch balances, trends or top products — the whole point is that the
 * landing screen paints fast. It also shares its cache entry with the "Today"
 * tab on /reports, so opening that afterwards is free.
 */
export function DashboardHome() {
  const summaryQuery = useReportSummary("today");
  const summary = summaryQuery.data;

  const header = (
    <PageHeader
      title="Dashboard"
      description={`Today · ${formatDate(new Date())}`}
    />
  );

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
          description="Please sign in again to see today's figures."
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
          title="Couldn't load today's figures"
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

  /**
   * Skeletons rather than zeros while loading — for exactly the reason this
   * whole component exists. `StatCard` counts up from 0 on mount, so rendering
   * it with a placeholder value would animate a real-looking figure to a number
   * that is not yet known.
   */
  if (summaryQuery.isPending || !summary) {
    return (
      <>
        {header}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3].map((card) => (
            <Skeleton key={card} className="h-[120px] rounded-xl" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total today"
          value={summary.combined.totalRevenue}
          icon={<BarChart3 />}
          accent="zinc"
          format="money"
        />
        <StatCard
          label="Beverages"
          value={summary.beverages.revenue}
          icon={<GlassWater />}
          accent="blue"
          format="money"
        />
        <StatCard
          label="Bakery"
          value={summary.bakery.revenue}
          icon={<ShoppingBag />}
          accent="amber"
          format="money"
        />
        <StatCard
          label="Milk sold"
          value={summary.milk.milkSalesRevenue}
          icon={<Milk />}
          accent="emerald"
          format="money"
        />
      </div>

      {/* Context line — a bare "Rs. 0" is ambiguous between "no sales yet" and
          "something is broken", so say which. */}
      <p className="num mt-4 text-sm text-zinc-500">
        {summary.beverages.salesCount + summary.bakery.salesCount === 0 &&
        summary.milk.milkSalesRevenue === 0
          ? "No sales recorded today yet."
          : `${summary.beverages.salesCount + summary.bakery.salesCount} ${
              summary.beverages.salesCount + summary.bakery.salesCount === 1
                ? "sale"
                : "sales"
            } · ${formatLiters(summary.milk.litersSold)} milk sold`}
      </p>

      {/* Quick actions ------------------------------------------------- */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <QuickLink href="/beverages/new-sale" label="New beverage sale" />
        <QuickLink href="/bakery/new-sale" label="New bakery sale" />
        <QuickLink href="/milk/quick-entry" label="Milk quick entry" />
      </div>
    </>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[44px] items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
    >
      {label}
    </Link>
  );
}
