import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getCustomerBalance } from "@/lib/receivables";
import { serialize } from "@/lib/serialize";
import { paymentCreateSchema } from "@/lib/validations/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

const PAYMENT_SELECT = {
  id: true,
  customerId: true,
  paymentDate: true,
  amount: true,
  method: true,
  notes: true,
  createdAt: true,
} as const;

/**
 * Payments a customer has MADE. Recording one never edits a sale — the sale is
 * what was billed and stays as billed; the payment is a separate fact, and the
 * balance is derived from both (see lib/receivables.ts).
 */

/** GET /api/customers/[id]/payments — newest first. */
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

    const payments = await prisma.customerPayment.findMany({
      where: { customerId: params.id },
      select: PAYMENT_SELECT,
      // createdAt breaks ties so same-day payments keep a stable order.
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    });

    // `amount` is a Decimal — an OBJECT, not a number (Gotcha 2).
    return ok(serialize(payments));
  } catch (error) {
    return serverError("customers.[id].payments.GET", error);
  }
}

/**
 * POST /api/customers/[id]/payments
 *
 * Body: { paymentDate, amount, method?, notes? }
 *
 * Returns the payment AND the recomputed balance, so the UI can show the new
 * outstanding without a second round trip — and, more importantly, so what it
 * shows comes from the same calculation as everywhere else rather than from
 * subtracting in the browser.
 */
export async function POST(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = paymentCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const customer = await prisma.customer.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!customer) return fail("That customer no longer exists.", 404);

    const { paymentDate, amount, method, notes } = parsed.data;

    const payment = await prisma.customerPayment.create({
      data: {
        customerId: params.id,
        paymentDate,
        amount,
        method: method ?? null,
        notes: notes ?? null,
      },
      select: PAYMENT_SELECT,
    });

    const balance = await getCustomerBalance(params.id);

    return ok(serialize({ payment, balance }), 201);
  } catch (error) {
    return serverError("customers.[id].payments.POST", error);
  }
}
