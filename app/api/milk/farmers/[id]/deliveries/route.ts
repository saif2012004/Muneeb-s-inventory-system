import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { endOfKarachiDay, startOfKarachiDay } from "@/lib/format";
import {
  DELIVERY_SELECT,
  computeDeliveryTotals,
  getFarmerBalance,
} from "@/lib/milk";
import { applyMilkStockDelta, findMilkProductId } from "@/lib/milk-stock";
import { prisma } from "@/lib/prisma";
import { buildSaleDateWindow, isSaleProblem } from "@/lib/sales";
import { serialize } from "@/lib/serialize";
import { deliveryCreateSchema } from "@/lib/validations/milk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

/**
 * Milk DELIVERIES — milk the owner buys FROM a farmer. Money flows out.
 *
 * Every delivery is one Karachi calendar day with up to two sessions. The
 * morning/evening split is the whole point: the owner logs them at different
 * times of day and needs to see which one is missing.
 */

/**
 * The delivery already recorded for this farmer on this Karachi day, if any.
 *
 * Matched over the whole Karachi DAY rather than by exact timestamp equality.
 * The schema normalises a `yyyy-MM-dd` input to Karachi midnight, but a full
 * ISO string passes through with its time intact, so an equality test would
 * miss an existing row and let the day be recorded twice.
 */
async function findDeliveryOnDay(farmerId: string, deliveryDate: Date) {
  return prisma.milkDelivery.findFirst({
    where: {
      farmerId,
      deliveryDate: {
        gte: startOfKarachiDay(deliveryDate),
        lt: endOfKarachiDay(deliveryDate),
      },
    },
    select: { id: true },
  });
}

/**
 * GET /api/milk/farmers/[id]/deliveries
 *
 * Query params (optional): dateFrom, dateTo — inclusive Karachi calendar days.
 *
 * Date filtering reuses `buildSaleDateWindow` from lib/sales.ts rather than
 * re-deriving it: `dateTo` becomes the start of the FOLLOWING Karachi day and
 * is compared with `lt`, so the named day is fully included without `lte`
 * double-counting a row landing exactly on midnight (Gotcha 4).
 */
export async function GET(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const window = buildSaleDateWindow(
      searchParams.get("dateFrom") ?? undefined,
      searchParams.get("dateTo") ?? undefined
    );
    if (isSaleProblem(window)) return fail(window.message, window.status);

    const farmer = await prisma.farmer.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!farmer) return fail("That farmer no longer exists.", 404);

    const deliveries = await prisma.milkDelivery.findMany({
      where: {
        farmerId: params.id,
        ...(window ? { deliveryDate: window } : {}),
      },
      select: DELIVERY_SELECT,
      // createdAt breaks ties so same-day rows keep a stable order.
      orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
    });

    // Decimals -> numbers (Gotcha 2). `serialize` leaves null alone, so a
    // missing morning session stays null and never renders as "0 L".
    return ok(serialize(deliveries));
  } catch (error) {
    return serverError("milk.farmers.[id].deliveries.GET", error);
  }
}

/**
 * POST /api/milk/farmers/[id]/deliveries
 *
 * Body: { deliveryDate, morningLiters?, eveningLiters?, ratePerLiter, notes? }
 *
 * `totalLiters` and `totalAmount` are STORED columns and are computed here from
 * Decimals — never accepted from the client. One helper does it for this route,
 * the edit route and quick entry, so the three cannot drift.
 *
 * ONE DELIVERY PER FARMER PER DAY is enforced here rather than by a database
 * constraint, because a constraint would mean a migration and Phase 5 needs
 * none. A second delivery for the same day is refused with a 409 that carries
 * the existing row's id, so the UI can offer "open the existing entry" instead
 * of leaving the owner stuck — a farmer's evening milk belongs on the SAME row
 * as their morning milk, not on a new one.
 */
export async function POST(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = deliveryCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const farmer = await prisma.farmer.findUnique({
      where: { id: params.id },
      select: { id: true, isActive: true, name: true },
    });
    if (!farmer) return fail("That farmer no longer exists.", 404);
    if (!farmer.isActive) {
      return fail(
        `"${farmer.name}" is retired. Reactivate them before recording a delivery.`,
        409
      );
    }

    const { deliveryDate, morningLiters, eveningLiters, ratePerLiter, notes } =
      parsed.data;

    const clash = await findDeliveryOnDay(params.id, deliveryDate);
    if (clash) {
      return NextResponse.json(
        {
          data: null,
          error:
            "A delivery is already recorded for this farmer on that date. Edit that entry to add the other session.",
          existingDeliveryId: clash.id,
        },
        { status: 409 }
      );
    }

    const totals = computeDeliveryTotals(
      morningLiters,
      eveningLiters,
      ratePerLiter
    );

    /**
     * THE DELIVERY-TO-STOCK BRIDGE. Recording a delivery adds its litres to the
     * milk product's stock, atomically with the delivery itself — a delivery
     * that recorded without its stock landing (or the reverse) is exactly the
     * drift this exists to prevent.
     *
     * The product is resolved OUTSIDE the transaction: it is one row, and at
     * ~1.1s a round trip there is no reason to hold a transaction open for it.
     *
     * A null id means the catalog has no milk product. The delivery still
     * records and the stock step is skipped — a farmer's record must never be
     * blocked by a catalog problem. See lib/milk-stock.ts.
     */
    const milkProductId = await findMilkProductId();
    if (!milkProductId) {
      console.error(
        "[milk.deliveries.POST] no milk product; delivery recorded without stock"
      );
    }

    const delivery = await prisma.$transaction(async (tx) => {
      // Delivery FIRST: it is the farmer's primary record, stock is the
      // side-effect. Both commit together either way.
      const row = await tx.milkDelivery.create({
        data: {
          farmerId: params.id,
          deliveryDate,
          notes: notes ?? null,
          ...totals,
        },
        select: DELIVERY_SELECT,
      });
      if (milkProductId) {
        await applyMilkStockDelta(tx, milkProductId, totals.totalLiters);
      }
      return row;
    });

    // The balance moved, so return the new one from the shared calculation
    // rather than letting the browser add it up (Gotcha 2).
    const balance = await getFarmerBalance(params.id);

    return ok(serialize({ delivery, balance }), 201);
  } catch (error) {
    return serverError("milk.farmers.[id].deliveries.POST", error);
  }
}
