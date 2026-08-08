import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
// `getCustomerActivity` is still THE single fetch of a customer's rows. The
// balance/ledger helpers alongside it (`summariseActivity`, `buildLedger`,
// `getCustomerBalance`) still exist and still work — they are simply no longer
// called, because a sale is revenue rather than a debt. See the GET below.
import { getCustomerActivity } from "@/lib/receivables";
import { serialize } from "@/lib/serialize";
import { customerUpdateSchema } from "@/lib/validations/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  type: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * GET /api/customers/[id]
 *
 * The profile: the customer, and their purchases across all three modules.
 *
 * It used to also return `balance`, `payments` and a running-balance `ledger`.
 * Those were removed when sales became revenue-only — there is no outstanding
 * figure any more, so computing one and shipping it to a UI that ignores it
 * would be dead weight the owner pays for on every profile open.
 *
 * Reversing this is small on purpose: call `summariseActivity(activity)` and
 * `buildLedger(activity)` again and put the fields back in the response. Both
 * still exist, and `activity` below already carries the payments they need.
 */
export async function GET(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: params.id },
      select: CUSTOMER_SELECT,
    });
    if (!customer) return fail("That customer no longer exists.", 404);

    // ONE fetch of this customer's rows. Previously each consumer queried
    // independently — 12 concurrent queries against a `connection_limit=1`
    // pool, which timed out in the browser while type-checking perfectly. See
    // getCustomerActivity.
    const activity = await getCustomerActivity(params.id);

    // Purchases from all three modules, merged newest-first and tagged with the
    // module so the UI can colour each row without guessing from its shape.
    const purchases = [
      ...activity.beverage.map((sale) => ({
        id: sale.id,
        module: "beverages" as const,
        saleDate: sale.saleDate,
        totalAmount: sale.totalAmount,
        notes: sale.notes,
        itemCount: sale._count.items,
        detail: null as string | null,
      })),
      ...activity.bakery.map((sale) => ({
        id: sale.id,
        module: "bakery" as const,
        saleDate: sale.saleDate,
        totalAmount: sale.totalAmount,
        notes: sale.notes,
        itemCount: sale._count.items,
        detail: null as string | null,
      })),
      ...activity.milk.map((sale) => ({
        id: sale.id,
        module: "milk" as const,
        saleDate: sale.saleDate,
        totalAmount: sale.totalAmount,
        notes: sale.notes,
        itemCount: null,
        detail: `${sale.liters.toString()} L × ${sale.ratePerLiter.toString()}`,
      })),
    ].sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime());

    // Decimals -> numbers at the boundary (Gotcha 2), for every branch.
    return ok(
      serialize({
        customer,
        purchases,
      })
    );
  } catch (error) {
    return serverError("customers.[id].GET", error);
  }
}

/** PATCH /api/customers/[id] — edit name, phone, type, or reactivate. */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = customerUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const existing = await prisma.customer.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) return fail("That customer no longer exists.", 404);

    // Renaming onto another customer's name would merge two ledgers visually
    // while leaving them separate in the data — the worst of both.
    if (parsed.data.name) {
      const clash = await prisma.customer.findFirst({
        where: {
          name: { equals: parsed.data.name, mode: "insensitive" },
          id: { not: params.id },
        },
        select: { id: true },
      });
      if (clash) {
        return fail(`A customer named "${parsed.data.name}" already exists.`, 409);
      }
    }

    const customer = await prisma.customer.update({
      where: { id: params.id },
      data: parsed.data,
      select: CUSTOMER_SELECT,
    });

    return ok(serialize(customer));
  } catch (error) {
    return serverError("customers.[id].PATCH", error);
  }
}

/**
 * DELETE /api/customers/[id] — SOFT delete, always.
 *
 * A customer is never hard-deleted, even with no history. Sales and payments
 * both point at this row, and a customer who is deleted takes the meaning of
 * every past sale with them — "who did I sell this to" would answer with a
 * dangling id. Deactivating retires them from new sales and keeps the ledger
 * readable, which is the same stance the catalog takes on products with
 * history (lib/catalog-guards.ts).
 *
 * The response says what happened so the UI can word its toast accurately.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, isActive: true },
    });
    if (!customer) return fail("That customer no longer exists.", 404);

    const deactivated = await prisma.customer.update({
      where: { id: customer.id },
      data: { isActive: false },
      select: CUSTOMER_SELECT,
    });

    // No balance is fetched or reported any more. This used to warn that the
    // customer still owed money before being retired; with sales as revenue
    // there is no debt to strand, so the check would only cost a query to
    // produce a sentence that can no longer be true.
    return ok({
      deleted: "soft" as const,
      customer: serialize(deactivated),
      message: `"${customer.name}" was deactivated. Their purchase history is kept.`,
    });
  } catch (error) {
    return serverError("customers.[id].DELETE", error);
  }
}
