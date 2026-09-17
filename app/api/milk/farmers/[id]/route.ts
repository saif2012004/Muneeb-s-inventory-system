import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import {
  buildFarmerLedger,
  getFarmerActivity,
  getFarmerBalance,
  summariseFarmerActivity,
} from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import { farmerUpdateSchema } from "@/lib/validations/milk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

const FARMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  address: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * GET /api/milk/farmers/[id]
 *
 * The farmer profile: the farmer, their net balance, their deliveries, their
 * purchases, and the running-balance ledger. One request, because the profile
 * screen shows all of it and three round trips would be three chances to render
 * a half-loaded page.
 *
 * THREE queries total (farmer + deliveries + purchases), awaited in series. The
 * rows are fetched ONCE and the balance, the two tables and the ledger are all
 * derived from that same set — the Phase 4b mistake was fetching the same sales
 * twice and fanning the lot out concurrently.
 */
export async function GET(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const farmer = await prisma.farmer.findUnique({
      where: { id: params.id },
      select: FARMER_SELECT,
    });
    if (!farmer) return fail("That farmer no longer exists.", 404);

    const activity = await getFarmerActivity(params.id);
    const balance = summariseFarmerActivity(activity);
    const ledger = buildFarmerLedger(activity);

    // Decimals -> numbers at the boundary (Gotcha 2), for every branch.
    //
    // NOTE: `serialize()` maps Decimal -> number and leaves null alone, so
    // morningLiters/eveningLiters keep the null-vs-zero distinction that
    // serializeLiters() exists to protect. A farmer who skipped the morning
    // must not render as "0 L".
    return ok(
      serialize({
        farmer,
        balance,
        deliveries: activity.deliveries,
        purchases: activity.purchases,
        ledger,
      })
    );
  } catch (error) {
    return serverError("milk.farmers.[id].GET", error);
  }
}

/** PATCH /api/milk/farmers/[id] — edit name, phone, address, or reactivate. */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = farmerUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const existing = await prisma.farmer.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) return fail("That farmer no longer exists.", 404);

    // Renaming onto another farmer's name would merge two balances visually
    // while leaving them separate in the data — the worst of both.
    if (parsed.data.name) {
      const clash = await prisma.farmer.findFirst({
        where: {
          name: { equals: parsed.data.name, mode: "insensitive" },
          id: { not: params.id },
        },
        select: { id: true },
      });
      if (clash) {
        return fail(`A farmer named "${parsed.data.name}" already exists.`, 409);
      }
    }

    const farmer = await prisma.farmer.update({
      where: { id: params.id },
      data: parsed.data,
      select: FARMER_SELECT,
    });

    return ok(serialize(farmer));
  } catch (error) {
    return serverError("milk.farmers.[id].PATCH", error);
  }
}

/**
 * DELETE /api/milk/farmers/[id] — SOFT delete, always.
 *
 * Same stance as Customer and as a Product with sale history: a farmer is never
 * hard-deleted. Deliveries and purchases both point at this row, and removing
 * it would take the meaning of every past delivery with it — "who did I buy
 * this milk from" would answer with a dangling id, and the money would vanish
 * from the books rather than being settled.
 *
 * Retiring a farmer the owner still OWES is allowed, because that is a real
 * situation, but the response says so explicitly. A debt that disappears
 * silently from the active list is a debt the owner never pays.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const farmer = await prisma.farmer.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, isActive: true },
    });
    if (!farmer) return fail("That farmer no longer exists.", 404);

    if (!farmer.isActive) {
      await prisma.$transaction(async (tx) => {
        await tx.milkDelivery.deleteMany({ where: { farmerId: farmer.id } });
        await tx.farmerPurchase.deleteMany({ where: { farmerId: farmer.id } });
        await tx.farmer.delete({ where: { id: farmer.id } });
      });

      return ok({
        deleted: "hard" as const,
        message: `"${farmer.name}" was deleted permanently.`,
      });
    }

    const balance = await getFarmerBalance(farmer.id);

    const retired = await prisma.farmer.update({
      where: { id: farmer.id },
      data: { isActive: false },
      select: FARMER_SELECT,
    });

    // POSITIVE means the OWNER owes the FARMER — the opposite of the customer
    // case. Getting this sentence backwards would tell the owner someone owes
    // them money when in fact they owe it.
    const owedToFarmer = balance.netBalanceOwed.greaterThan(0);
    const farmerIsAhead = balance.netBalanceOwed.lessThan(0);

    let message = `"${farmer.name}" was retired. Their history is kept.`;
    if (owedToFarmer) {
      message = `"${farmer.name}" was retired, but you still owe them ${balance.netBalanceOwed.toFixed(2)}. Their history and balance are kept.`;
    } else if (farmerIsAhead) {
      message = `"${farmer.name}" was retired. They are ${balance.netBalanceOwed.negated().toFixed(2)} ahead on purchases. Their history and balance are kept.`;
    }

    return ok({
      deleted: "soft" as const,
      farmer: serialize(retired),
      netBalanceOwed: serialize(balance.netBalanceOwed),
      message,
    });
  } catch (error) {
    return serverError("milk.farmers.[id].DELETE", error);
  }
}
