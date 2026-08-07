import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { PURCHASE_SELECT, getFarmerBalance } from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { buildSaleDateWindow, isSaleProblem } from "@/lib/sales";
import { serialize } from "@/lib/serialize";
import { purchaseCreateSchema } from "@/lib/validations/milk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

/**
 * FARMER PURCHASES — goods the farmer took from the shop (cow food, milk,
 * yogurt, tea powder, whatever else).
 *
 * This is NOT a sale and must never be recorded as one. A sale is billed to a
 * Customer and increases what the owner is owed; a farmer purchase is settled
 * against milk the owner already owes for, and REDUCES the farmer's net
 * balance. Recording one of these as a MilkSale would double-count it — the
 * farmer would be charged for goods AND the shop would show revenue it never
 * received in cash.
 */

/** GET /api/milk/farmers/[id]/purchases — newest first, optional date window. */
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

    const purchases = await prisma.farmerPurchase.findMany({
      where: {
        farmerId: params.id,
        ...(window ? { purchaseDate: window } : {}),
      },
      select: PURCHASE_SELECT,
      // createdAt breaks ties so same-day purchases keep a stable order.
      orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
    });

    // `amount` is a Decimal — an OBJECT, not a number (Gotcha 2).
    return ok(serialize(purchases));
  } catch (error) {
    return serverError("milk.farmers.[id].purchases.GET", error);
  }
}

/**
 * POST /api/milk/farmers/[id]/purchases
 *
 * Body: { purchaseDate, itemDescription, amount, notes? }
 *
 * Returns the purchase AND the recomputed balance, so the UI shows the new net
 * owed without a second round trip — and, more importantly, so what it shows
 * comes from the shared calculation rather than from subtracting in the browser.
 *
 * Unlike a delivery there is no one-per-day rule: a farmer can genuinely take
 * cow food in the morning and yogurt in the afternoon, and those are two
 * separate purchases with separate descriptions.
 */
export async function POST(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = purchaseCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const farmer = await prisma.farmer.findUnique({
      where: { id: params.id },
      select: { id: true, isActive: true, name: true },
    });
    if (!farmer) return fail("That farmer no longer exists.", 404);
    if (!farmer.isActive) {
      return fail(
        `"${farmer.name}" is retired. Reactivate them before recording a purchase.`,
        409
      );
    }

    const { purchaseDate, itemDescription, amount, notes } = parsed.data;

    const purchase = await prisma.farmerPurchase.create({
      data: {
        farmerId: params.id,
        purchaseDate,
        itemDescription,
        amount,
        notes: notes ?? null,
      },
      select: PURCHASE_SELECT,
    });

    const balance = await getFarmerBalance(params.id);

    return ok(serialize({ purchase, balance }), 201);
  } catch (error) {
    return serverError("milk.farmers.[id].purchases.POST", error);
  }
}
