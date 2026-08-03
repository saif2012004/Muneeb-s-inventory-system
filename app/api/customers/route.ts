import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { customerCreateSchema } from "@/lib/validations/customers";

// Prisma cannot run on Edge (Gotcha 3).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minimal customer endpoints — just enough for the sale form to pick or add a
 * customer. The full customers hub (payments, outstanding balances, the
 * receivables view) is Phase 4b; deliberately nothing about money here.
 *
 * No Decimal fields are returned, so no serializer is needed.
 */

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  type: true,
  isActive: true,
} as const;

/**
 * GET /api/customers
 *
 * Query params (all optional):
 *   search           case-insensitive name match
 *   includeInactive  "true" to include deactivated customers
 *
 * Inactive customers are hidden by default so the sale form's picker only
 * offers people the owner still trades with.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const includeInactive = searchParams.get("includeInactive") === "true";

    const customers = await prisma.customer.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search
          ? { name: { contains: search, mode: "insensitive" as const } }
          : {}),
      },
      select: CUSTOMER_SELECT,
      orderBy: { name: "asc" },
    });

    return ok(customers);
  } catch (error) {
    return serverError("customers.GET", error);
  }
}

/** POST /api/customers — add a customer from the sale form. */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = customerCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { name, phone, type } = parsed.data;

    // Customer.name is not unique in the schema, so this is a friendliness
    // check rather than a constraint — two "Al Madina Hotel" rows would split
    // one shop's ledger in two and the owner would never notice.
    const existing = await prisma.customer.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return fail(`A customer named "${name}" already exists.`, 409);

    const customer = await prisma.customer.create({
      data: { name, phone: phone ?? null, type },
      select: CUSTOMER_SELECT,
    });

    return ok(customer, 201);
  } catch (error) {
    return serverError("customers.POST", error);
  }
}
