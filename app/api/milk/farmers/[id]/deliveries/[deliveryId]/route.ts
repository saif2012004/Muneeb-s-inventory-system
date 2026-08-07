import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { endOfKarachiDay, startOfKarachiDay } from "@/lib/format";
import {
  DELIVERY_SELECT,
  computeDeliveryTotals,
  getFarmerBalance,
} from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import {
  EMPTY_DELIVERY_ERROR,
  deliveryUpdateSchema,
  isEmptyDelivery,
} from "@/lib/validations/milk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string; deliveryId: string } };

/**
 * Both handlers look the delivery up SCOPED BY farmerId, not by id alone. A
 * delivery id belonging to another farmer must not be editable or deletable
 * through this farmer's URL — otherwise a stale tab could move litres and money
 * between two farmers' balances.
 */
async function findScopedDelivery(farmerId: string, deliveryId: string) {
  return prisma.milkDelivery.findFirst({
    where: { id: deliveryId, farmerId },
    select: {
      id: true,
      deliveryDate: true,
      morningLiters: true,
      eveningLiters: true,
      ratePerLiter: true,
    },
  });
}

/**
 * PATCH /api/milk/farmers/[id]/deliveries/[deliveryId]
 *
 * The common edit by far is adding the evening session to a row created in the
 * morning, so a partial body has to be handled properly rather than treated as
 * a full replacement.
 *
 * MERGE SEMANTICS, matching the payments route:
 *   - key omitted        -> leave the stored value alone
 *   - key sent as null   -> clear that session ("they didn't come after all")
 *   - key sent as number -> set it
 *
 * The null-vs-omitted distinction is the whole reason the columns are nullable.
 * Collapsing it would make "no evening delivery" indistinguishable from "an
 * evening delivery of 0 litres".
 */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = deliveryUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const existing = await findScopedDelivery(params.id, params.deliveryId);
    if (!existing) return fail("That delivery no longer exists.", 404);

    const patch = parsed.data;

    // Merge the patch onto the stored row. `undefined` means "not mentioned",
    // so the stored value survives; an explicit null clears the session.
    const merged = {
      morningLiters:
        patch.morningLiters === undefined
          ? (existing.morningLiters?.toNumber() ?? null)
          : (patch.morningLiters ?? null),
      eveningLiters:
        patch.eveningLiters === undefined
          ? (existing.eveningLiters?.toNumber() ?? null)
          : (patch.eveningLiters ?? null),
      ratePerLiter: patch.ratePerLiter ?? existing.ratePerLiter.toNumber(),
      deliveryDate: patch.deliveryDate ?? existing.deliveryDate,
    };

    // Only checkable on the MERGED row — a patch of `{ morningLiters: null }`
    // says nothing about the evening, so the schema cannot decide this alone.
    // Clearing the last session would otherwise leave a 0-litre, 0-value
    // delivery sitting in the ledger.
    if (isEmptyDelivery(merged)) {
      return fail(`${EMPTY_DELIVERY_ERROR}, or delete the delivery.`, 400);
    }

    // Moving a delivery onto a day the farmer already has one would create the
    // duplicate the POST route refuses. Only worth checking when the date
    // actually moved.
    if (patch.deliveryDate) {
      const clash = await prisma.milkDelivery.findFirst({
        where: {
          farmerId: params.id,
          id: { not: existing.id },
          deliveryDate: {
            gte: startOfKarachiDay(merged.deliveryDate),
            lt: endOfKarachiDay(merged.deliveryDate),
          },
        },
        select: { id: true },
      });
      if (clash) {
        return fail(
          "This farmer already has a delivery recorded on that date.",
          409
        );
      }
    }

    const totals = computeDeliveryTotals(
      merged.morningLiters,
      merged.eveningLiters,
      merged.ratePerLiter
    );

    const delivery = await prisma.milkDelivery.update({
      where: { id: existing.id },
      data: {
        deliveryDate: merged.deliveryDate,
        ...totals,
        // Nullable text: an explicit null clears it, an omitted key leaves it.
        ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
      },
      select: DELIVERY_SELECT,
    });

    const balance = await getFarmerBalance(params.id);

    return ok(serialize({ delivery, balance }));
  } catch (error) {
    return serverError("milk.farmers.[id].deliveries.[deliveryId].PATCH", error);
  }
}

/**
 * DELETE /api/milk/farmers/[id]/deliveries/[deliveryId]
 *
 * A genuine hard delete, like a customer payment and unlike a farmer. A
 * delivery is a single standalone fact that nothing else references; a
 * mistakenly recorded one should vanish rather than linger as a deactivated row
 * that still has to be explained. Removing it lowers what the owner owes by
 * exactly that amount.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const existing = await findScopedDelivery(params.id, params.deliveryId);
    if (!existing) return fail("That delivery no longer exists.", 404);

    await prisma.milkDelivery.delete({ where: { id: existing.id } });

    const balance = await getFarmerBalance(params.id);

    return ok(serialize({ deleted: "hard" as const, id: existing.id, balance }));
  } catch (error) {
    return serverError("milk.farmers.[id].deliveries.[deliveryId].DELETE", error);
  }
}
