import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { MILK_SALE_SELECT, computeMilkSaleTotal } from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { getCustomerBalance } from "@/lib/receivables";
import { checkTotalFits } from "@/lib/sales";
import { serialize } from "@/lib/serialize";
import { milkSaleUpdateSchema } from "@/lib/validations/milk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

/** GET /api/milk/sales/[id] — one sale, for a detail view or an edit form. */
export async function GET(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const sale = await prisma.milkSale.findUnique({
      where: { id: params.id },
      select: MILK_SALE_SELECT,
    });
    if (!sale) return fail("That sale no longer exists.", 404);

    return ok(serialize(sale));
  } catch (error) {
    return serverError("milk.sales.[id].GET", error);
  }
}

/**
 * PATCH /api/milk/sales/[id] — correct the date, litres, rate or notes.
 *
 * `customerId` is NOT editable, deliberately (see lib/validations/milk.ts):
 * moving a sale between customers rewrites two balances at once with nothing on
 * either ledger explaining why. A sale recorded against the wrong customer is
 * fixed by deleting it and entering it again.
 *
 * `totalAmount` is always recomputed from the MERGED litres and rate — a patch
 * that changes only the rate must still move the total, and a client-supplied
 * total is never trusted.
 */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = milkSaleUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const existing = await prisma.milkSale.findUnique({
      where: { id: params.id },
      select: { id: true, customerId: true, liters: true, ratePerLiter: true },
    });
    if (!existing) return fail("That sale no longer exists.", 404);

    const patch = parsed.data;

    const liters = patch.liters ?? existing.liters.toNumber();
    const ratePerLiter = patch.ratePerLiter ?? existing.ratePerLiter.toNumber();
    const totalAmount = computeMilkSaleTotal(liters, ratePerLiter);

    const tooLarge = checkTotalFits(totalAmount);
    if (tooLarge) return fail(tooLarge.message, tooLarge.status);

    const sale = await prisma.milkSale.update({
      where: { id: existing.id },
      data: {
        ...(patch.saleDate ? { saleDate: patch.saleDate } : {}),
        liters,
        ratePerLiter,
        totalAmount,
        // `notes` is nullable: an explicit null clears it, an omitted key
        // leaves it untouched.
        ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
      },
      select: MILK_SALE_SELECT,
    });

    // The receivable moved, so return the new balance from the shared
    // calculation rather than letting the browser recompute it.
    const balance = await getCustomerBalance(existing.customerId);

    return ok(serialize({ sale, balance }));
  } catch (error) {
    return serverError("milk.sales.[id].PATCH", error);
  }
}

/**
 * DELETE /api/milk/sales/[id]
 *
 * Hard delete, like a customer payment and a milk delivery. A milk sale has no
 * line items and nothing references it, so a mistaken one should vanish rather
 * than linger as a deactivated row. Removing it lowers the customer's
 * outstanding by exactly that amount.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const existing = await prisma.milkSale.findUnique({
      where: { id: params.id },
      select: { id: true, customerId: true },
    });
    if (!existing) return fail("That sale no longer exists.", 404);

    await prisma.milkSale.delete({ where: { id: existing.id } });

    const balance = await getCustomerBalance(existing.customerId);

    return ok(serialize({ deleted: "hard" as const, id: existing.id, balance }));
  } catch (error) {
    return serverError("milk.sales.[id].DELETE", error);
  }
}
