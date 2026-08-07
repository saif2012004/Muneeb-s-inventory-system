import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getCustomerBalance } from "@/lib/receivables";
import { serialize } from "@/lib/serialize";
import { paymentUpdateSchema } from "@/lib/validations/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string; paymentId: string } };

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
 * Both handlers look the payment up SCOPED BY customerId, not by id alone. A
 * payment id from another customer's ledger must not be editable or deletable
 * through this customer's URL — otherwise a stale tab could move money between
 * two customers' balances.
 */
async function findScopedPayment(customerId: string, paymentId: string) {
  return prisma.customerPayment.findFirst({
    where: { id: paymentId, customerId },
    select: { id: true },
  });
}

/** PATCH /api/customers/[id]/payments/[paymentId] — correct a recorded payment. */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = paymentUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const existing = await findScopedPayment(params.id, params.paymentId);
    if (!existing) return fail("That payment no longer exists.", 404);

    const payment = await prisma.customerPayment.update({
      where: { id: existing.id },
      data: {
        ...parsed.data,
        // `method` and `notes` are nullable: an explicit null clears them,
        // while an omitted key leaves them untouched.
        ...(parsed.data.method !== undefined
          ? { method: parsed.data.method ?? null }
          : {}),
        ...(parsed.data.notes !== undefined
          ? { notes: parsed.data.notes ?? null }
          : {}),
      },
      select: PAYMENT_SELECT,
    });

    // The balance moved, so return the new one from the shared calculation.
    const balance = await getCustomerBalance(params.id);

    return ok(serialize({ payment, balance }));
  } catch (error) {
    return serverError("customers.[id].payments.[paymentId].PATCH", error);
  }
}

/**
 * DELETE /api/customers/[id]/payments/[paymentId]
 *
 * A genuine hard delete, unlike a customer or a product. A payment is a single
 * standalone fact that nothing else references; a mistakenly recorded one
 * should vanish, not linger as a deactivated row that still has to be explained.
 * Deleting it puts the outstanding balance back up by exactly that amount.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const existing = await findScopedPayment(params.id, params.paymentId);
    if (!existing) return fail("That payment no longer exists.", 404);

    await prisma.customerPayment.delete({ where: { id: existing.id } });

    const balance = await getCustomerBalance(params.id);

    return ok(serialize({ deleted: "hard" as const, id: existing.id, balance }));
  } catch (error) {
    return serverError("customers.[id].payments.[paymentId].DELETE", error);
  }
}
