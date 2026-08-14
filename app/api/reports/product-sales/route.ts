import { NextResponse } from "next/server";

import { ok, requireOwner, serverError } from "@/lib/api";
import {
  REPORT_PERIODS,
  getProductSales,
  reportRange,
  type ReportPeriod,
} from "@/lib/reports";
import { serialize } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/product-sales?period=…
 *
 * EVERY product's units sold and revenue in the period, across all three shops
 * — the owner's #20. Milk appears as its OWN line rather than folded into a
 * category, because the rows carry `SaleItem.moduleKey`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN ROUTE AND NOT PART OF /summary
 * ---------------------------------------------------------------------------
 * Same reason `/balances` was split out: the dashboard's headline figures must
 * paint without waiting on anything heavier. This is TWO queries (a grouped scan
 * and a name lookup) and is rendered further down the page, so it loads behind
 * its own skeleton while the numbers at the top are already readable.
 *
 * Unlike `/top-products` it is NOT limited and NOT per-module: the question is
 * "how much of everything sold", which is a table the owner reads, not a chart's
 * top five.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get("period") ?? "month") as ReportPeriod;
    if (!REPORT_PERIODS.includes(period)) {
      return serverError(
        "reports.product-sales.GET",
        new Error(`Unknown period: ${period}`)
      );
    }

    const rows = await getProductSales(reportRange(period));

    // Decimals are already numbers here (the raw query casts to text and this
    // parses), but serialize() stays as the boundary contract — Gotcha 2.
    return ok(serialize(rows));
  } catch (error) {
    return serverError("reports.product-sales.GET", error);
  }
}
