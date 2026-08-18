import { Prisma } from "@prisma/client";

import { karachiRange, type DateRange } from "@/lib/format";
import {
  PRODUCT_MODULES,
  TREND_GROUPINGS,
  TREND_MODULES,
  type ProductModule,
  type ReportPeriod,
  type TrendGrouping,
  type TrendModule,
} from "@/lib/reports-display";
import { getAllFarmerTotals } from "@/lib/milk";
import { prisma } from "@/lib/prisma";
// The migration-A dedupe, shared with lib/receivables.ts — ONE definition, so
// revenue and balances cannot disagree about which Sale rows are real.
// NOTE: lib/receivables.ts is intentionally NOT imported any more. It still
// exists and still works; nothing calls it. See getBalanceTotals() below.

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
// `sumOrZero` lived here for Prisma's `_sum`, which returns null when nothing
// matched. S6 moved the last aggregate off `groupBy` and onto raw SQL, where
// `dec()` below does the same job for a text-cast numeric — so it went with it.

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/**
 * Periods, groupings and module keys now live in `lib/reports-display.ts` —
 * client-safe, Prisma-free — and are re-exported here so every server caller
 * and API route is unchanged. See Gotcha 3b: client components must not reach
 * this module, because it imports Prisma.
 */
export {
  REPORT_PERIODS,
  REPORT_PERIOD_LABELS,
  TREND_MODULES,
  TREND_GROUPINGS,
  PRODUCT_MODULES,
  type ReportPeriod,
  type TrendModule,
  type TrendGrouping,
  type ProductModule,
} from "@/lib/reports-display";

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


/**
 * Table per module. A FIXED map, never built from user input — the table name
 * is the one part of the query below that cannot be a bound parameter, so it
 * must come from here and nowhere else.
 */

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

  /**
   * ONE row source since S9: the unified sale lines of this module.
   *
   * It was a UNION ALL of the old per-module sale table and these lines, because
   * a bill could live in either. Migration B dropped the old tables, so the
   * union has one arm and the interpolated table name is gone with it.
   *
   * The aggregate is unchanged and both halves of it still matter:
   *   - `SUM(revenue)` uses `netLineTotal`, so a mixed bill contributes only
   *     THIS module's share — never the bill's `totalAmount`, which would
   *     attribute a cross-shop sale entirely to one shop;
   *   - `COUNT(DISTINCT sale_id)` counts a three-line bill ONCE, not three times.
   *
   * The Karachi bucketing expression is character-for-character the one verified
   * against the live database above.
   */
  const rows = await prisma.$queryRaw<TrendRow[]>`
    SELECT
      period,
      SUM(revenue)::text        AS revenue,
      COUNT(DISTINCT sale_id)   AS count
    FROM (
      SELECT
        to_char(
          date_trunc(
            ${groupBy},
            (s."saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi'
          ),
          'YYYY-MM-DD'
        )                       AS period,
        i."netLineTotal"        AS revenue,
        s.id                    AS sale_id
      FROM "SaleItem" i
      JOIN "Sale" s ON s.id = i."saleId"
      WHERE i."moduleKey" = ${module}
        AND s."saleDate" >= ${range.start} AND s."saleDate" < ${range.end}
    ) AS combined
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


type TopProductRow = {
  product_id: string;
  quantity: string | null;
  revenue: string | null;
};

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

  // Defence in depth: the type constrains this, but a table name is
  // interpolated below.
  if (!PRODUCT_MODULES.includes(module)) throw new Error("Unknown module");

  /**
   * TWO queries: one grouped scan, one name lookup for the winners.
   *
   * It scanned the old per-module item table too until S9 — that arm went with
   * Migration B, and milk gained a real one for the first time: it never had a
   * per-module item table, so before the till existed there was nothing here to
   * count, which is why `getTopProducts("milk")` used to come back empty even
   * when milk had sold.
   *
   * Raw SQL rather than a `groupBy`, for the reason that governs this file: the
   * ranking and LIMIT belong in the database, and a hand-rolled JS re-sort is
   * the kind of thing that quietly disagrees with the table beside it.
   *
   * Quantity may be FRACTIONAL — 12.5 litres of milk is an ordinary quantity
   * since Migration C.
   */
  const rows = await prisma.$queryRaw<TopProductRow[]>`
    SELECT
      i."productId"                        AS product_id,
      /* BASE UNITS (the owner's Q3, option A): a peti counts as 360 eggs, not
         as 1. That is the figure that reconciles against stock, which is what
         the owner checks it against — and the only one that stays comparable
         across months when the same goods sell in different units. */
      SUM(i.quantity * i."unitFactor")::text AS quantity,
      SUM(i."netLineTotal")::text          AS revenue
    FROM "SaleItem" i
    JOIN "Sale" s ON s.id = i."saleId"
    WHERE i."moduleKey" = ${module}
      AND s."saleDate" >= ${range.start} AND s."saleDate" < ${range.end}
    GROUP BY i."productId"
    ORDER BY SUM(i."netLineTotal") DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((row) => row.product_id) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(products.map((p) => [p.id, p.name]));

  return rows.map((row) => ({
    productId: row.product_id,
    // A product deleted outright would leave a dangling id. The catalog guard
    // soft-deletes anything with sales, so this should never fire — but a
    // report must not render "undefined" if it ever does.
    productName: nameById.get(row.product_id) ?? "Unknown product",
    quantity: Number(Number(row.quantity ?? 0).toFixed(2)),
    revenue: Number(Number(row.revenue ?? 0).toFixed(2)),
  }));
}

// ---------------------------------------------------------------------------
// Per-product sales (CHECKLIST #20)
// ---------------------------------------------------------------------------

export type ProductSalesRow = {
  productId: string;
  productName: string;
  /** What it was SOLD AS — snapshotted, so milk is its own line, not "bakery". */
  moduleKey: string;
  unit: string | null;
  quantity: number;
  revenue: number;
};

type ProductSalesRawRow = {
  product_id: string;
  module_key: string;
  quantity: string | null;
  revenue: string | null;
};

/**
 * EVERY product's units sold and revenue in a window, across all three shops —
 * the owner's #20: "not just per-category totals, but how much of each product".
 *
 * Grouped by (product, moduleKey) rather than product alone, deliberately:
 * `moduleKey` is what makes **milk show up as its own line** instead of being
 * folded into whatever category its product happens to sit under today. It is
 * also the snapshot, so recategorising a product in the catalog cannot
 * retroactively move last month's sales between shops.
 *
 * TWO queries regardless of how many products sold: one grouped scan, one
 * name/unit lookup for the rows that came back.
 *
 * It scanned four sources until S9 — the two old item tables, the unified lines,
 * and the retired `MilkSale` rows mapped onto `prod_milk` so the table would
 * reconcile with the summary above it. All four are now one, because every bill
 * is a `Sale`.
 */
export async function getProductSales(range: DateRange): Promise<ProductSalesRow[]> {
  const rows = await prisma.$queryRaw<ProductSalesRawRow[]>`
    SELECT
      i."productId"                          AS product_id,
      i."moduleKey"                          AS module_key,
      /* BASE UNITS — see the note in getTopProducts. */
      SUM(i.quantity * i."unitFactor")::text AS quantity,
      SUM(i."netLineTotal")::text            AS revenue
    FROM "SaleItem" i
    JOIN "Sale" s ON s.id = i."saleId"
    WHERE s."saleDate" >= ${range.start} AND s."saleDate" < ${range.end}
    GROUP BY i."productId", i."moduleKey"
    ORDER BY SUM(i."netLineTotal") DESC
  `;

  if (rows.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((row) => row.product_id) } },
    select: { id: true, name: true, unit: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return rows.map((row) => ({
    productId: row.product_id,
    productName: byId.get(row.product_id)?.name ?? "Unknown product",
    moduleKey: row.module_key,
    // "litre" / "cotton" — without it a bare 12.5 next to a bare 3 is ambiguous.
    unit: byId.get(row.product_id)?.unit ?? null,
    // May be FRACTIONAL: 12.5 litres of milk (Migration C).
    quantity: Number(Number(row.quantity ?? 0).toFixed(2)),
    revenue: Number(Number(row.revenue ?? 0).toFixed(2)),
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
 * It is also NOT period-scoped, which is what makes the split free: a balance
 * is what is owed right now, not what accrued this month, so switching period
 * tabs does not invalidate this at all.
 *
 * The arithmetic is still delegated — `getAllFarmerTotals` lives in
 * lib/milk.ts. This is a loading change, not a maths change.
 */
/**
 * FARMERS ONLY — the receivables half was removed deliberately.
 *
 * A sale is revenue, not a debt: the app no longer tracks what a customer owes,
 * so there is no "outstanding receivables" figure to report. The FARMER side is
 * untouched, because the owner genuinely does still owe farmers money for milk
 * delivered, and that is a real payable.
 *
 * `getTotalOutstanding()` in lib/receivables.ts still exists and still works —
 * it is simply no longer called. That is what makes this reversible: restoring
 * the tile means adding the call back here and the tile back to the dashboard,
 * with no migration and no lost data.
 *
 * The cost saving is the point of the change as much as the semantics:
 * `getTotalOutstanding()` is FOUR queries, and at the measured ~1.05s per round
 * trip that was 4+ seconds on every cold dashboard load. Measured before and
 * after — see docs/responses/2026-08-09-batch-2-receivables-removed.md.
 */
export type BalanceTotals = {
  farmers: { totalOwed: Prisma.Decimal; totalAdvanced: Prisma.Decimal };
};

export async function getBalanceTotals(): Promise<BalanceTotals> {
  const farmers = await getAllFarmerTotals();
  return { farmers };
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
  del_liters: string | null;
  del_value: string | null;
  purchases: string | null;
  // Revenue is Σ netLineTotal BY moduleKey — never the sale's totalAmount,
  // which would attribute a mixed bill entirely to whichever module happened to
  // be asked about. The `u_` prefix is a leftover from when these sat beside a
  // second set read off the old per-module tables; it is kept because renaming
  // seven aliases is churn that would obscure the real change in this diff.
  u_bev_revenue: string | null;
  u_bev_count: bigint;
  u_bak_revenue: string | null;
  u_bak_count: bigint;
  u_milk_revenue: string | null;
  u_milk_count: bigint;
  u_milk_liters: string | null;
};

const dec = (value: string | null): Prisma.Decimal =>
  value === null ? ZERO : new Prisma.Decimal(value);

export async function getReportSummary(
  period: ReportPeriod
): Promise<ReportSummary> {
  const range = reportRange(period);
  const { start, end } = range;

  /**
   * Every period flow in ONE round trip.
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
      (SELECT SUM("totalLiters")::text FROM "MilkDelivery"
         WHERE "deliveryDate" >= ${start} AND "deliveryDate" < ${end}) AS del_liters,
      (SELECT SUM("totalAmount")::text FROM "MilkDelivery"
         WHERE "deliveryDate" >= ${start} AND "deliveryDate" < ${end}) AS del_value,
      (SELECT SUM("amount")::text FROM "FarmerPurchase"
         WHERE "purchaseDate" >= ${start} AND "purchaseDate" < ${end}) AS purchases,

      /* ------------------------------------------------------------------
       * SALES, PER MODULE. Seven scalar subqueries, still ONE round trip —
       * which is the whole reason the summary is written this way.
       *
       * Revenue is SUM(netLineTotal) grouped by moduleKey, NOT the sale's
       * totalAmount: a bill holding beverages and milk contributes its
       * beverage lines to beverages and its milk lines to milk. Summing
       * totalAmount per module would count that bill twice over and make the
       * modules add up to more than the business took.
       *
       * COUNT(DISTINCT s.id) — a mixed bill is ONE sale for each module it
       * touches, not one per line. Note the modules' counts therefore do not
       * add up to "bills rung", and should not be presented as if they did.
       *
       * Before S9 each of these was paired with a second subquery against the
       * old per-module table, and every one carried a NOT EXISTS to skip rows
       * that were copies of those tables. Migration B took both away.
       * ------------------------------------------------------------------ */
      (SELECT SUM(i."netLineTotal")::text FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
         WHERE i."moduleKey" = 'beverages' AND s."saleDate" >= ${start} AND s."saleDate" < ${end})
                                                                  AS u_bev_revenue,
      (SELECT COUNT(DISTINCT s.id) FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
         WHERE i."moduleKey" = 'beverages' AND s."saleDate" >= ${start} AND s."saleDate" < ${end})
                                                                  AS u_bev_count,
      (SELECT SUM(i."netLineTotal")::text FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
         WHERE i."moduleKey" = 'bakery' AND s."saleDate" >= ${start} AND s."saleDate" < ${end})
                                                                  AS u_bak_revenue,
      (SELECT COUNT(DISTINCT s.id) FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
         WHERE i."moduleKey" = 'bakery' AND s."saleDate" >= ${start} AND s."saleDate" < ${end})
                                                                  AS u_bak_count,
      (SELECT SUM(i."netLineTotal")::text FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
         WHERE i."moduleKey" = 'milk' AND s."saleDate" >= ${start} AND s."saleDate" < ${end})
                                                                  AS u_milk_revenue,
      (SELECT COUNT(DISTINCT s.id) FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
         WHERE i."moduleKey" = 'milk' AND s."saleDate" >= ${start} AND s."saleDate" < ${end})
                                                                  AS u_milk_count,
      /* Litres SOLD on the till: the milk line's quantity IS litres. */
      (SELECT SUM(i.quantity * i."unitFactor")::text FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
         WHERE i."moduleKey" = 'milk' AND s."saleDate" >= ${start} AND s."saleDate" < ${end})
                                                                  AS u_milk_liters
  `;

  // Balances are NOT fetched here — they are six queries and would hold the
  // whole dashboard on the slowest thing it needs. See getBalanceTotals().
  const beverageRevenue = dec(flows.u_bev_revenue);
  const bakeryRevenue = dec(flows.u_bak_revenue);
  const milkSalesRevenue = dec(flows.u_milk_revenue);
  const milkValue = dec(flows.del_value);
  const purchases = dec(flows.purchases);

  return {
    period,
    range: { start, end },
    beverages: {
      salesCount: Number(flows.u_bev_count),
      revenue: beverageRevenue,
      // Top product is NOT computed here. The dashboard already fetches
      // /api/reports/top-products for its charts, and duplicating it cost four
      // extra round trips — over four seconds — for a value it already had.
      topProduct: null,
    },
    bakery: {
      salesCount: Number(flows.u_bak_count),
      revenue: bakeryRevenue,
      topProduct: null,
    },
    milk: {
      litersReceived: dec(flows.del_liters),
      milkValue,
      farmerPurchases: purchases,
      netMilkCost: milkValue.sub(purchases),
      // Litres sold: a milk line's quantity IS litres. It used to add the
      // retired `MilkSale` rows too; those went with Migration B, and their
      // litres are in the unified lines they were copied to.
      litersSold: dec(flows.u_milk_liters),
      milkSalesRevenue,
    },
    combined: {
      totalRevenue: beverageRevenue.add(bakeryRevenue).add(milkSalesRevenue),
    },
  };
}
