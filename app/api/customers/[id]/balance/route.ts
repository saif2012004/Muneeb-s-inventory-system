import { NextResponse } from "next/server";

import { fail, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getCustomerBalance } from "@/lib/receivables";
import { serialize } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

/**
 * GET /api/customers/[id]/balance
 *
 * `{ totalBilled, totalPaid, outstanding, lastSaleDate, lastPaymentDate }`
 *
 * The balance on its own, for callers that need the number without the ledger
 * — a dashboard tile, a future report, a re-check after a write. It runs the
 * SAME `getCustomerBalance` as the profile and the payment routes, so it can
 * never quote a different figure from the screen next to it.
 */
export async function GET(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!customer) return fail("That customer no longer exists.", 404);

    const balance = await getCustomerBalance(params.id);

    // Decimals -> numbers at the boundary (Gotcha 2). A customer with no
    // history returns zeros and null dates — a valid answer, not an error.
    return ok(serialize(balance));
  } catch (error) {
    return serverError("customers.[id].balance.GET", error);
  }
}
