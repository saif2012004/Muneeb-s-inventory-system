import { NextResponse } from "next/server";

import { fail, ok, requireOwner, serverError } from "@/lib/api";
import {
  PRODUCT_MODULES,
  REPORT_PERIODS,
  getTopProducts,
  reportRange,
  type ProductModule,
  type ReportPeriod,
} from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 5;

/**
 * GET /api/reports/top-products?module=beverages|bakery&period=…&limit=5
 *
 * Best sellers by REVENUE, descending. Two queries whatever the limit.
 *
 * Milk is absent on purpose: a MilkSale has no line items and no product, so
 * there is nothing to rank. That is a property of the schema, not an omission.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);

    // Named `moduleKey`, not `module` — Next forbids assigning to `module`.
    const moduleKey = (searchParams.get("module") ?? "beverages") as ProductModule;
    if (!PRODUCT_MODULES.includes(moduleKey)) {
      return fail(
        `Unknown module. Use one of: ${PRODUCT_MODULES.join(", ")}.`,
        400
      );
    }

    const period = (searchParams.get("period") ?? "month") as ReportPeriod;
    if (!REPORT_PERIODS.includes(period)) {
      return fail(`Unknown period. Use one of: ${REPORT_PERIODS.join(", ")}.`, 400);
    }

    const parsedLimit = Number(searchParams.get("limit"));
    const limit =
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

    // getTopProducts already returns plain numbers.
    const products = await getTopProducts({
      module: moduleKey,
      range: reportRange(period),
      limit,
    });

    return ok(products);
  } catch (error) {
    return serverError("reports.top-products.GET", error);
  }
}
