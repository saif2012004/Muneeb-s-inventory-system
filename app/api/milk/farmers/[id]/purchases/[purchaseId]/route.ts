import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { PURCHASE_SELECT, getFarmerBalance } from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import { purchaseUpdateSchema } from "@/lib/validations/milk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string; purchaseId: string } };

/**
 * Scoped by farmerId, not by id alone — a purchase belonging to another farmer
 * must not be editable or deletable through this farmer's URL, or a stale tab
 * could move money between two farmers' balances.
 */
async function findScopedPurchase(farmerId: string, purchaseId: string) {
  return prisma.farmerPurchase.findFirst({
    where: { id: purchaseId, farmerId },
    select: { id: true },
  });
}

/** PATCH /api/milk/farmers/[id]/purchases/[purchaseId] — correct a purchase. */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = purchaseUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const existing = await findScopedPurchase(params.id, params.purchaseId);
    if (!existing) return fail("That purchase no longer exists.", 404);

    const purchase = await prisma.farmerPurchase.update({
      where: { id: existing.id },
      data: {
        ...parsed.data,
        // `notes` is nullable: an explicit null clears it, while an omitted key
        // leaves it untouched.
        ...(parsed.data.notes !== undefined
          ? { notes: parsed.data.notes ?? null }
          : {}),
      },
      select: PURCHASE_SELECT,
    });

    // The balance moved, so return the new one from the shared calculation.
    const balance = await getFarmerBalance(params.id);

    return ok(serialize({ purchase, balance }));
  } catch (error) {
    return serverError("milk.farmers.[id].purchases.[purchaseId].PATCH", error);
  }
}

/**
 * DELETE /api/milk/farmers/[id]/purchases/[purchaseId]
 *
 * Hard delete, like a delivery and a customer payment. Nothing references a
 * purchase row, so a mistaken one should vanish rather than linger. Removing it
 * raises what the owner owes the farmer by exactly that amount.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const existing = await findScopedPurchase(params.id, params.purchaseId);
    if (!existing) return fail("That purchase no longer exists.", 404);

    await prisma.farmerPurchase.delete({ where: { id: existing.id } });

    const balance = await getFarmerBalance(params.id);

    return ok(serialize({ deleted: "hard" as const, id: existing.id, balance }));
  } catch (error) {
    return serverError("milk.farmers.[id].purchases.[purchaseId].DELETE", error);
  }
}
