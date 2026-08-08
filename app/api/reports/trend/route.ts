import { NextResponse } from "next/server";

import { fail, ok, requireOwner, serverError } from "@/lib/api";
import { endOfKarachiDay, startOfKarachiDay } from "@/lib/format";
import {
  TREND_GROUPINGS,
  TREND_MODULES,
  getTrend,
  reportRange,
  REPORT_PERIODS,
  type ReportPeriod,
  type TrendGrouping,
  type TrendModule,
} from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/reports/trend
 *   ?module=beverages|bakery|milk
 *   &groupBy=day|week|month
 *   &dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD   (or &period=today|week|month|year)
 *
 * Returns `[{ period, revenue, count }]` — ONE `date_trunc … GROUP BY` in the
 * database, not a query per day. The cost does not grow with the length of the
 * window; only the number of returned buckets does.
 *
 * Buckets are Karachi calendar periods, so a sale at 1am PKT lands on that
 * Karachi day rather than the previous UTC one.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);

    // Named `moduleKey`, not `module` — Next forbids assigning to `module`.
    const moduleKey = (searchParams.get("module") ?? "beverages") as TrendModule;
    if (!TREND_MODULES.includes(moduleKey)) {
      return fail(`Unknown module. Use one of: ${TREND_MODULES.join(", ")}.`, 400);
    }

    const groupBy = (searchParams.get("groupBy") ?? "day") as TrendGrouping;
    if (!TREND_GROUPINGS.includes(groupBy)) {
      return fail(
        `Unknown grouping. Use one of: ${TREND_GROUPINGS.join(", ")}.`,
        400
      );
    }

    const dateFrom = searchParams.get("dateFrom")?.trim();
    const dateTo = searchParams.get("dateTo")?.trim();

    let range;
    if (dateFrom || dateTo) {
      if (!dateFrom || !dateTo) {
        return fail("Give both dateFrom and dateTo, or neither.", 400);
      }
      if (!DATE_ONLY.test(dateFrom) || !DATE_ONLY.test(dateTo)) {
        return fail("Dates must be YYYY-MM-DD.", 400);
      }
      const start = startOfKarachiDay(dateFrom);
      // Exclusive upper bound at the START of the following Karachi day, so the
      // named end date is fully included without `lte` double-counting midnight.
      const end = endOfKarachiDay(dateTo);
      if (start >= end) {
        return fail("The start date must be on or before the end date.", 400);
      }
      range = { start, end };
    } else {
      const period = (searchParams.get("period") ?? "month") as ReportPeriod;
      if (!REPORT_PERIODS.includes(period)) {
        return fail(
          `Unknown period. Use one of: ${REPORT_PERIODS.join(", ")}.`,
          400
        );
      }
      range = reportRange(period);
    }

    // Already plain numbers and strings — getTrend converts at its own boundary
    // because the raw query returns numeric-as-text and a bigint count.
    const points = await getTrend({ module: moduleKey, groupBy, range });

    return ok(points);
  } catch (error) {
    return serverError("reports.trend.GET", error);
  }
}
