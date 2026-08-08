import { NextResponse } from "next/server";

import { ok, requireOwner, serverError } from "@/lib/api";
import { getBalanceTotals } from "@/lib/reports";
import { serialize } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/balances
 *
 * Outstanding receivables and money owed to farmers — the ALL-TIME half of the
 * reports dashboard, split out of `/summary` so the fast figures can paint
 * without waiting on it.
 *
 * Takes no period parameter, deliberately: a balance is what is owed right now,
 * not what accrued in a window. That is also why switching period tabs on the
 * dashboard does not refetch this.
 *
 * Both figures come from the modules that own them (lib/receivables.ts and
 * lib/milk.ts), so they are identical to the customers hub and the farmer
 * balance sheet rather than a second calculation that agrees today.
 */
export async function GET(): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const totals = await getBalanceTotals();

    // Decimals -> numbers at the boundary (Gotcha 2).
    return ok(serialize(totals));
  } catch (error) {
    return serverError("reports.balances.GET", error);
  }
}
