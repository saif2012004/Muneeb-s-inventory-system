import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import {
  getFarmerBalances,
  summariseFarmerBalances,
} from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import { farmerCreateSchema } from "@/lib/validations/milk";

// Prisma cannot run on Edge (Gotcha 3).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Farmers — the people the owner BUYS milk from.
 *
 * Not customers. A Customer owes the owner money; a Farmer is owed money BY the
 * owner. They are separate tables with opposite money direction, and the two
 * must never be conflated in the UI. See the sign note in lib/milk.ts.
 */

const FARMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  address: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * GET /api/milk/farmers
 *
 * Query params (all optional):
 *   search           case-insensitive name match
 *   includeInactive  "true" to include retired farmers
 *   withBalances     "false" to skip the balance aggregation
 *
 * Balances are ON by default — "what do I owe each farmer" is the question the
 * milk hub exists to answer. The quick-entry screen and any picker pass
 * `withBalances=false`, since two aggregate queries to render a list of names
 * is waste.
 *
 * Cost with balances is a FIXED two aggregate queries for the whole list, not
 * one per farmer (see lib/milk.ts).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const withBalances = searchParams.get("withBalances") !== "false";

    const farmers = await prisma.farmer.findMany({
      where: {
        ...(search
          ? { name: { contains: search, mode: "insensitive" as const } }
          : {}),
      },
      select: FARMER_SELECT,
      orderBy: { name: "asc" },
    });

    if (!withBalances) {
      return ok({ farmers: serialize(farmers), summary: null });
    }

    const balances = await getFarmerBalances(farmers.map((f) => f.id));

    // Decimals -> numbers at the boundary (Gotcha 2). Every id is present in
    // the map by construction, so the fallbacks are belt-and-braces.
    const rows = farmers.map((farmer) => {
      const balance = balances.get(farmer.id);
      return {
        ...serialize(farmer),
        totalMilkValue: serialize(balance?.totalMilkValue ?? 0),
        totalPurchases: serialize(balance?.totalPurchases ?? 0),
        netBalanceOwed: serialize(balance?.netBalanceOwed ?? 0),
        totalLiters: serialize(balance?.totalLiters ?? 0),
        lastDeliveryDate: balance?.lastDeliveryDate ?? null,
        lastPurchaseDate: balance?.lastPurchaseDate ?? null,
      };
    });

    // Summarised from the balances already in hand — no extra queries. Debts
    // and advances are reported separately and never netted; see
    // summariseFarmerBalances for why that distinction matters.
    const summary = summariseFarmerBalances(Array.from(balances.values()));

    return ok({ farmers: rows, summary: serialize(summary) });
  } catch (error) {
    return serverError("milk.farmers.GET", error);
  }
}

/** POST /api/milk/farmers — add a farmer. */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = farmerCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { name, phone, address } = parsed.data;

    // Farmer.name is not unique in the schema, so this is a friendliness check
    // rather than a constraint — two "Ali" rows would split one man's balance
    // in two, and the owner would pay him half of what he is owed without
    // either of them noticing.
    const existing = await prisma.farmer.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, isActive: true },
    });
    if (existing) {
      return fail(
        existing.isActive
          ? `A farmer named "${name}" already exists.`
          : `A retired farmer named "${name}" already exists. Reactivate them instead.`,
        409
      );
    }

    const farmer = await prisma.farmer.create({
      data: { name, phone: phone ?? null, address: address ?? null },
      select: FARMER_SELECT,
    });

    // A new farmer has no history, so their balance is a known zero — no point
    // aggregating for it.
    return ok(
      {
        ...serialize(farmer),
        totalMilkValue: 0,
        totalPurchases: 0,
        netBalanceOwed: 0,
        totalLiters: 0,
        lastDeliveryDate: null,
        lastPurchaseDate: null,
      },
      201
    );
  } catch (error) {
    return serverError("milk.farmers.POST", error);
  }
}
