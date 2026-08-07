import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getCustomerBalances } from "@/lib/receivables";
import { serialize } from "@/lib/serialize";
import { customerCreateSchema } from "@/lib/validations/customers";

// Prisma cannot run on Edge (Gotcha 3).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Customers, shared across beverages, bakery and milk.
 *
 * Phase 3 shipped this as a bare picker feed. Phase 4b adds the receivables:
 * every row now carries its outstanding balance, because "who owes me money"
 * is the question the hub exists to answer.
 */

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  type: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * GET /api/customers
 *
 * Query params (all optional):
 *   search           case-insensitive name match
 *   includeInactive  "true" to include deactivated customers
 *   withBalances     "false" to skip the receivables aggregation
 *
 * Balances are ON by default so the hub gets them in one round trip. The sale
 * form's picker passes `withBalances=false` — it only needs names, and four
 * aggregate queries to render a dropdown is waste.
 *
 * Cost is a FIXED four aggregate queries for the whole list, not one per
 * customer — see lib/receivables.ts.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const includeInactive = searchParams.get("includeInactive") === "true";
    const withBalances = searchParams.get("withBalances") !== "false";

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

    if (!withBalances) return ok(serialize(customers));

    const balances = await getCustomerBalances(customers.map((c) => c.id));

    // Decimals -> numbers at the boundary (Gotcha 2). Every id is present in
    // the map by construction, so the fallback below is belt-and-braces rather
    // than an expected path.
    return ok(
      customers.map((customer) => {
        const balance = balances.get(customer.id);
        return {
          ...serialize(customer),
          totalBilled: serialize(balance?.totalBilled ?? 0),
          totalPaid: serialize(balance?.totalPaid ?? 0),
          outstanding: serialize(balance?.outstanding ?? 0),
          lastSaleDate: balance?.lastSaleDate ?? null,
          lastPaymentDate: balance?.lastPaymentDate ?? null,
        };
      })
    );
  } catch (error) {
    return serverError("customers.GET", error);
  }
}

/** POST /api/customers — add a customer. */
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

    // A new customer has no history, so their balance is a known zero — no
    // point aggregating for it.
    return ok(
      {
        ...serialize(customer),
        totalBilled: 0,
        totalPaid: 0,
        outstanding: 0,
        lastSaleDate: null,
        lastPaymentDate: null,
      },
      201
    );
  } catch (error) {
    return serverError("customers.POST", error);
  }
}
