import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { endOfKarachiDay, startOfKarachiDay } from "@/lib/format";
import {
  DELIVERY_SELECT,
  computeDeliveryTotals,
  getFarmerBalance,
} from "@/lib/milk";
import {
  applyMilkStockDelta,
  findMilkProductId,
  milkStockReversalMessage,
  readMilkStock,
} from "@/lib/milk-stock";
import { prisma } from "@/lib/prisma";
import { StockConflictError } from "@/lib/sales";
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
      // The PRIOR litres, for the stock delta. Added with the delivery-to-stock
      // bridge: without it neither PATCH nor DELETE can tell how much stock this
      // delivery had contributed, and stock would drift on every edit.
      // Deliberately the stored value rather than one re-derived from
      // morning+evening — it is what was actually added.
      totalLiters: true,
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

  // Hoisted so the catch can name the amount in the refusal message; a `const`
  // inside the try would not be in scope there.
  let reversalLiters = 0;

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

    /**
     * STOCK, RECONCILED BY DELTA — not by re-adding the new litres.
     *
     * The delivery already contributed `existing.totalLiters` to milk stock, so
     * an edit moves stock by the DIFFERENCE. 40 L corrected to 25 L gives 15 L
     * back; 40 L to 60 L takes 20 more. Re-adding the full new figure would
     * double-count, which is the exact bug the quick-entry evening pass would
     * hit every single day.
     */
    const milkProductId = await findMilkProductId();
    if (!milkProductId) {
      console.error(
        "[milk.deliveries.PATCH] no milk product; delivery edited without stock"
      );
    }
    const stockDelta = milkProductId
      ? totals.totalLiters.minus(existing.totalLiters)
      : null;
    // How much stock this edit tries to take back, for the refusal message.
    reversalLiters = stockDelta?.isNegative() ? -Number(stockDelta) : 0;

    const delivery = await prisma.$transaction(async (tx) => {
      // Delivery FIRST: the farmer's record is primary, stock is the side-effect.
      const row = await tx.milkDelivery.update({
        where: { id: existing.id },
        data: {
          deliveryDate: merged.deliveryDate,
          ...totals,
          // Nullable text: an explicit null clears it, an omitted key leaves it.
          ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
        },
        select: DELIVERY_SELECT,
      });
      if (milkProductId && stockDelta) {
        await applyMilkStockDelta(tx, milkProductId, stockDelta);
      }
      return row;
    });

    const balance = await getFarmerBalance(params.id);

    return ok(serialize({ delivery, balance }));
  } catch (error) {
    // Reducing the litres would have driven milk stock below zero — some of it
    // has already been sold. Refused, never clamped and never negative, with a
    // message that names the fix instead of stranding the owner.
    if (error instanceof StockConflictError) {
      const available = await readMilkStock(error.productId);
      return fail(milkStockReversalMessage(reversalLiters, available ?? 0), 409);
    }
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

  let reversalLiters = 0;

  try {
    const existing = await findScopedDelivery(params.id, params.deliveryId);
    if (!existing) return fail("That delivery no longer exists.", 404);

    reversalLiters = Number(existing.totalLiters);

    /**
     * Deleting a delivery takes its litres back OUT of milk stock. If more has
     * been sold than remains, the conditional update inside applyStockDeltas
     * refuses rather than going negative, and the catch turns that into a 409
     * naming the fix.
     */
    const milkProductId = await findMilkProductId();
    if (!milkProductId) {
      console.error(
        "[milk.deliveries.DELETE] no milk product; delivery deleted without stock"
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.milkDelivery.delete({ where: { id: existing.id } });
      if (milkProductId) {
        await applyMilkStockDelta(tx, milkProductId, existing.totalLiters.neg());
      }
    });

    const balance = await getFarmerBalance(params.id);

    return ok(serialize({ deleted: "hard" as const, id: existing.id, balance }));
  } catch (error) {
    if (error instanceof StockConflictError) {
      const available = await readMilkStock(error.productId);
      return fail(milkStockReversalMessage(reversalLiters, available ?? 0), 409);
    }
    return serverError("milk.farmers.[id].deliveries.[deliveryId].DELETE", error);
  }
}
