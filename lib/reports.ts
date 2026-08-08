import { Prisma } from "@prisma/client";

import { karachiRange, type DateRange } from "@/lib/format";
import { getAllFarmerTotals } from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { getTotalOutstanding } from "@/lib/receivables";

/**
 * THE REPORTS AGGREGATION. One place, so a figure is computed once and every
 * view, chart and CSV reads the same source.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE DOES NOT RE-DERIVE BALANCES
 * ---------------------------------------------------------------------------
 * Customer receivables come from `lib/receivables.ts` and farmer balances from
 * `lib/milk.ts` — this module CALLS them. A reports screen showing a different
 * number from the screen it summarises is worse than no reports screen, and the
 * only way to guarantee they agree is for there to be one implementation.
 *
 * What is genuinely new here — revenue per period, top products — lives here
 * and nowhere else.
 *
 * ---------------------------------------------------------------------------
 * QUERY COUNT IS FIXED, AND MUST STAY THAT WAY
 * ---------------------------------------------------------------------------
 * Nothing below loops a query over days, products, customers or farmers. The
 * trend is ONE `date_trunc … GROUP BY` in the database, not a query per day;
 * top products is one `groupBy` plus one name lookup. Everything is awaited in
 * SERIES — with `connection_limit=1` a `Promise.all` does not run in parallel,
 * it queues behind the single connection and the queries at the back exceed the
 * 10s pool timeout (the Phase 4b bug, guardrailed in CLAUDE.md).
 */

const ZERO = new Prisma.Decimal(0);

function sumOrZero(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value ?? ZERO;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const REPORT_PERIODS = ["today", "week", "month", "year"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
};

/**
 * A report period resolved to a half-open UTC window whose boundaries are
 * Karachi midnights.
 *
 * Delegates to `karachiRange` rather than doing its own date maths — that
 * helper already handles the Monday week start and the `gte`/`lt` half-open
 * convention that stops a sale landing exactly on midnight being counted twice.
 */
export function reportRange(period: ReportPeriod): DateRange {
  switch (period) {
    case "today":
      return karachiRange("today");
    case "week":
      return karachiRange("thisWeek");
    case "month":
      return karachiRange("thisMonth");
    case "year":
      return karachiRange("thisYear");
  }
}

// ---------------------------------------------------------------------------
// Trend — revenue over time
// ---------------------------------------------------------------------------

export const TREND_MODULES = ["beverages", "bakery", "milk"] as const;
export type TrendModule = (typeof TREND_MODULES)[number];

export const TREND_GROUPINGS = ["day", "week", "month"] as const;
export type TrendGrouping = (typeof TREND_GROUPINGS)[number];

/**
 * Table per module. A FIXED map, never built from user input — the table name
 * is the one part of the query below that cannot be a bound parameter, so it
 * must come from here and nowhere else.
 */
const TREND_TABLE: Record<TrendModule, string> = {
  beverages: "BeverageSale",
  bakery: "BakerySale",
  milk: "MilkSale",
};

export type TrendPoint = {
  /** Karachi calendar bucket, `YYYY-MM-DD`. */
  period: string;
  revenue: number;
  count: number;
};

type TrendRow = { period: string; revenue: string | null; count: bigint };

/**
 * Revenue and sale count per Karachi period, in ONE query.
 *
 * ---------------------------------------------------------------------------
 * WHY RAW SQL HERE
 * ---------------------------------------------------------------------------
 * Prisma's `groupBy` can only group by a COLUMN, not by an expression, so there
 * is no way to ask it for "revenue per day". The two alternatives are a query
 * per day — which scales with the window and is exactly what the brief forbids
 * — or loading every sale row and bucketing in JS, which transfers the whole
 * period to the app. `date_trunc` in the database does it in one statement and
 * transfers one row per bucket.
 *
 * ---------------------------------------------------------------------------
 * THE TIMEZONE EXPRESSION (verified against the live DB before it was used)
 * ---------------------------------------------------------------------------
 * The columns are `timestamp without time zone` holding UTC instants, so:
 *
 *   ("saleDate" AT TIME ZONE 'UTC')            -> a timestamptz at that instant
 *   (… AT TIME ZONE 'Asia/Karachi')            -> Karachi wall-clock timestamp
 *   date_trunc(unit, …)                        -> the Karachi day/week/month
 *
 * Checked on the real database, not assumed:
 *   19:30 UTC 7 Aug (00:30 PKT 8 Aug) -> 2026-08-08   (rolls over correctly)
 *   18:30 UTC 7 Aug (23:30 PKT 7 Aug) -> 2026-08-07   (does NOT roll over)
 *   20:00 UTC 7 Aug (01:00 PKT 8 Aug) -> 2026-08-08, week 2026-08-03 (Monday)
 *   31 Aug 19:30 UTC                  -> month 2026-09-01
 *
 * `to_char` returns the bucket as a plain string on purpose: a naive
 * `timestamp` coming back through the driver would be re-interpreted in the
 * server's local zone, which is the whole class of bug this is avoiding.
 *
 * `unit` is BOUND as a parameter (`date_trunc(text, timestamp)` accepts one)
 * and is additionally allowlisted by its type, so nothing user-supplied is ever
 * interpolated into the statement.
 */
export async function getTrend(options: {
  module: TrendModule;
  groupBy: TrendGrouping;
  range: DateRange;
}): Promise<TrendPoint[]> {
  const { module, groupBy, range } = options;

  // Defence in depth: the type already constrains these, but this is a raw
  // query and the table name is interpolated.
  if (!TREND_MODULES.includes(module)) throw new Error("Unknown module");
  if (!TREND_GROUPINGS.includes(groupBy)) throw new Error("Unknown grouping");

  const table = Prisma.raw(`"${TREND_TABLE[module]}"`);

  const rows = await prisma.$queryRaw<TrendRow[]>`
    SELECT
      to_char(
        date_trunc(
          ${groupBy},
          ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi'
        ),
        'YYYY-MM-DD'
      ) AS period,
      SUM("totalAmount")::text AS revenue,
      COUNT(*) AS count
    FROM ${table}
    WHERE "saleDate" >= ${range.start} AND "saleDate" < ${range.end}
    GROUP BY 1
    ORDER BY 1
  `;

  return rows.map((row) => ({
    period: row.period,
    // Cast to text in SQL then parsed here: numeric would otherwise arrive as a
    // Decimal-ish value that JSON.stringify cannot be trusted with.
    revenue: Number(Number(row.revenue ?? 0).toFixed(2)),
    // COUNT(*) is a bigint, and JSON.stringify throws on BigInt.
    count: Number(row.count),
  }));
}

// ---------------------------------------------------------------------------
// Top products
// ---------------------------------------------------------------------------

export const PRODUCT_MODULES = ["beverages", "bakery"] as const;
export type ProductModule = (typeof PRODUCT_MODULES)[number];

export type TopProduct = {
  productId: string;
  productName: string;
  quantity: number;
  revenue: number;
};

/**
 * Best-selling products by revenue in a window — TWO queries, whatever the
 * limit: one `groupBy` over the line items, one name lookup for the winners.
 *
 * Milk has no equivalent because a MilkSale has no line items and no product —
 * it is litres × rate on a single row. That asymmetry is why this takes
 * `ProductModule` rather than `TrendModule`.
 */
export async function getTopProducts(options: {
  module: ProductModule;
  range: DateRange;
  limit: number;
}): Promise<TopProduct[]> {
  const { module, range, limit } = options;
  const where = { sale: { saleDate: { gte: range.start, lt: range.end } } };

  // Written out per model rather than shared: Prisma types `by` per model, so
  // one literal cannot satisfy both item tables.
  const grouped =
    module === "beverages"
      ? await prisma.beverageSaleItem.groupBy({
          by: ["productId"],
          where,
          _sum: { quantity: true, lineTotal: true },
          orderBy: { _sum: { lineTotal: "desc" } },
          take: limit,
        })
      : await prisma.bakerySaleItem.groupBy({
          by: ["productId"],
          where,
          _sum: { quantity: true, lineTotal: true },
          orderBy: { _sum: { lineTotal: "desc" } },
          take: limit,
        });

  if (grouped.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((row) => row.productId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(products.map((p) => [p.id, p.name]));

  return grouped.map((row) => ({
    productId: row.productId,
    // A product deleted outright would leave a dangling id. The catalog guard
    // soft-deletes anything with sales, so this should never fire — but a
    // report must not render "undefined" if it ever does.
    productName: nameById.get(row.productId) ?? "Unknown product",
    quantity: row._sum.quantity ?? 0,
    revenue: Number(sumOrZero(row._sum.lineTotal).toFixed(2)),
  }));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export type ReportSummary = {
  period: ReportPeriod;
  range: { start: Date; end: Date };
  beverages: { salesCount: number; revenue: Prisma.Decimal; topProduct: string | null };
  bakery: { salesCount: number; revenue: Prisma.Decimal; topProduct: string | null };
  milk: {
    litersReceived: Prisma.Decimal;
    milkValue: Prisma.Decimal;
    farmerPurchases: Prisma.Decimal;
    /** milkValue − farmerPurchases: what the period's milk actually cost. */
    netMilkCost: Prisma.Decimal;
    litersSold: Prisma.Decimal;
    milkSalesRevenue: Prisma.Decimal;
  };
  combined: { totalRevenue: Prisma.Decimal };
};

/**
 * The two ALL-TIME balances, split out of the summary on purpose.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE CALL
 * ---------------------------------------------------------------------------
 * These are the expensive half. The period flows above are ONE query; these two
 * figures are SIX, because a total of positive balances has to be grouped per
 * customer and per farmer before it can be summed (a credit must not cancel
 * someone else's debt). At roughly a second per round trip that is the
 * difference between a dashboard that paints immediately and one that waits.
 *
 * Keeping them in the same response meant the whole landing page — revenue,
 * trend, charts, everything — was held hostage by the slowest query, and the
 * total crept toward the 15s client timeout in lib/api-client.ts. Now the fast
 * half renders and these two tiles fill in behind their own skeletons.
 *
 * They are also NOT period-scoped, which is what makes the split free: a
 * balance is what is owed right now, not what accrued this month, so switching
 * period tabs does not invalidate this at all.
 *
 * The arithmetic is unchanged and still delegated — `getTotalOutstanding` lives
 * in lib/receivables.ts and `getAllFarmerTotals` in lib/milk.ts. This is a
 * loading change, not a maths change.
 */
export type BalanceTotals = {
  receivables: { totalOutstanding: Prisma.Decimal };
  farmers: { totalOwed: Prisma.Decimal; totalAdvanced: Prisma.Decimal };
};

export async function getBalanceTotals(): Promise<BalanceTotals> {
  const totalOutstanding = await getTotalOutstanding();
  const farmers = await getAllFarmerTotals();
  return { receivables: { totalOutstanding }, farmers };
}

/**
 * Everything the dashboard's top half needs.
 *
 * ---------------------------------------------------------------------------
 * FLOWS ARE PERIOD-SCOPED; BALANCES ARE NOT
 * ---------------------------------------------------------------------------
 * Revenue, litres and counts are measured over the chosen window. Outstanding
 * receivables and money owed to farmers are BALANCES — they are what is owed
 * right now, not what accrued this month, and scoping them to a period would
 * produce a number that looks like a debt but isn't one. They are therefore
 * all-time, which is also what makes them match the customers hub and the
 * balance sheet exactly.
 *
 * REVENUE means money IN: beverages + bakery + milk SOLD. Milk deliveries are
 * money OUT and are reported separately as a cost, never added to revenue.
 *
 * Everything is awaited in series. The count is fixed — it does not grow with
 * the number of days in the period, customers, farmers or products.
 */
type PeriodFlowRow = {
  bev_revenue: string | null;
  bev_count: bigint;
  bak_revenue: string | null;
  bak_count: bigint;
  del_liters: string | null;
  del_value: string | null;
  purchases: string | null;
  sold_liters: string | null;
  sold_revenue: string | null;
};

const dec = (value: string | null): Prisma.Decimal =>
  value === null ? ZERO : new Prisma.Decimal(value);

export async function getReportSummary(
  period: ReportPeriod
): Promise<ReportSummary> {
  const range = reportRange(period);
  const { start, end } = range;

  /**
   * All five period flows in ONE round trip.
   *
   * This started as five separate `aggregate` calls, which is the more
   * idiomatic Prisma. It was measured and rejected: a single round trip to
   * Supabase costs about **1.1 seconds** here, `connection_limit=1` forces
   * every query to run in series, and the summary was taking **19 seconds** —
   * past the client's 15s timeout, so the dashboard rendered "Can't reach the
   * server" on a perfectly healthy database. Five scalar subqueries in one
   * statement cost one round trip instead of five.
   *
   * This is NEW aggregation, not a balance, so it belongs here. The receivables
   * and farmer figures below are still delegated — those are balances and their
   * arithmetic lives in their own modules.
   *
   * Amounts are cast to text so they arrive as exact strings and become
   * Decimals here; counts come back as bigint and are converted before they can
   * reach JSON.stringify.
   */
  const [flows] = await prisma.$queryRaw<PeriodFlowRow[]>`
    SELECT
      (SELECT SUM("totalAmount")::text FROM "BeverageSale"
         WHERE "saleDate" >= ${start} AND "saleDate" < ${end})     AS bev_revenue,
      (SELECT COUNT(*) FROM "BeverageSale"
         WHERE "saleDate" >= ${start} AND "saleDate" < ${end})     AS bev_count,
      (SELECT SUM("totalAmount")::text FROM "BakerySale"
         WHERE "saleDate" >= ${start} AND "saleDate" < ${end})     AS bak_revenue,
      (SELECT COUNT(*) FROM "BakerySale"
         WHERE "saleDate" >= ${start} AND "saleDate" < ${end})     AS bak_count,
      (SELECT SUM("totalLiters")::text FROM "MilkDelivery"
         WHERE "deliveryDate" >= ${start} AND "deliveryDate" < ${end}) AS del_liters,
      (SELECT SUM("totalAmount")::text FROM "MilkDelivery"
         WHERE "deliveryDate" >= ${start} AND "deliveryDate" < ${end}) AS del_value,
      (SELECT SUM("amount")::text FROM "FarmerPurchase"
         WHERE "purchaseDate" >= ${start} AND "purchaseDate" < ${end}) AS purchases,
      (SELECT SUM("liters")::text FROM "MilkSale"
         WHERE "saleDate" >= ${start} AND "saleDate" < ${end})     AS sold_liters,
      (SELECT SUM("totalAmount")::text FROM "MilkSale"
         WHERE "saleDate" >= ${start} AND "saleDate" < ${end})     AS sold_revenue
  `;

  // Balances are NOT fetched here — they are six queries and would hold the
  // whole dashboard on the slowest thing it needs. See getBalanceTotals().
  const beverageRevenue = dec(flows.bev_revenue);
  const bakeryRevenue = dec(flows.bak_revenue);
  const milkSalesRevenue = dec(flows.sold_revenue);
  const milkValue = dec(flows.del_value);
  const purchases = dec(flows.purchases);

  return {
    period,
    range: { start, end },
    beverages: {
      salesCount: Number(flows.bev_count),
      revenue: beverageRevenue,
      // Top product is NOT computed here. The dashboard already fetches
      // /api/reports/top-products for its charts, and duplicating it cost four
      // extra round trips — over four seconds — for a value it already had.
      topProduct: null,
    },
    bakery: {
      salesCount: Number(flows.bak_count),
      revenue: bakeryRevenue,
      topProduct: null,
    },
    milk: {
      litersReceived: dec(flows.del_liters),
      milkValue,
      farmerPurchases: purchases,
      netMilkCost: milkValue.sub(purchases),
      litersSold: dec(flows.sold_liters),
      milkSalesRevenue,
    },
    combined: {
      totalRevenue: beverageRevenue.add(bakeryRevenue).add(milkSalesRevenue),
    },
  };
}
