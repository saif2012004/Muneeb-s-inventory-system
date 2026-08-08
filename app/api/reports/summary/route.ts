import { NextResponse } from "next/server";

import { fail, ok, requireOwner, serverError } from "@/lib/api";
import {
  REPORT_PERIODS,
  getReportSummary,
  type ReportPeriod,
} from "@/lib/reports";
import { serialize } from "@/lib/serialize";

// Prisma cannot run on Edge (Gotcha 3).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/summary?period=today|week|month|year
 *
 * Every figure comes from lib/reports.ts, which in turn calls the existing
 * receivables and milk-balance helpers rather than re-deriving them — so
 * "Outstanding receivables" here is the same number the customers hub shows,
 * and "Owed to farmers" is the same number the balance sheet shows.
 *
 * Flows (revenue, litres, counts) are scoped to the period; BALANCES are
 * all-time, because what someone owes right now is not a thing that accrues
 * within a window.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const requested = (searchParams.get("period") ?? "month") as ReportPeriod;

    if (!REPORT_PERIODS.includes(requested)) {
      return fail(
        `Unknown period. Use one of: ${REPORT_PERIODS.join(", ")}.`,
        400
      );
    }

    const summary = await getReportSummary(requested);

    // Decimals -> numbers at the boundary (Gotcha 2). Every money and litre
    // field above is a Decimal; none of them may reach the browser as objects.
    return ok(serialize(summary));
  } catch (error) {
    return serverError("reports.summary.GET", error);
  }
}
