import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  buildLedger,
  getCustomerActivity,
  getCustomerBalance,
  summariseActivity,
} from "@/lib/receivables";
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
 * The profile: the customer, their balance, their purchases across all three
 * modules, their payments, and the running-balance ledger. One request, because
 * the profile screen shows all of it and three round trips would just be three
 * chances to render a half-loaded page.
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

    // ONE fetch of this customer's rows, reused for the balance, the purchases
    // list and the ledger. Previously each of those queried independently —
    // 12 concurrent queries against a `connection_limit=1` pool, which timed
    // out in the browser while type-checking perfectly. See getCustomerActivity.
    const activity = await getCustomerActivity(params.id);
    const balance = summariseActivity(activity);
    const ledger = buildLedger(activity);

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

    // Newest first for display; the ledger stays oldest-first because a running
    // balance only reads correctly downwards.
    const payments = [...activity.payments].sort((a, b) => {
      const byDate = b.paymentDate.getTime() - a.paymentDate.getTime();
      return byDate !== 0 ? byDate : b.createdAt.getTime() - a.createdAt.getTime();
    });

    // Decimals -> numbers at the boundary (Gotcha 2), for every branch.
    return ok(
      serialize({
        customer,
        balance,
        purchases,
        payments,
        ledger,
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

    const balance = await getCustomerBalance(customer.id);

    const deactivated = await prisma.customer.update({
      where: { id: customer.id },
      data: { isActive: false },
      select: CUSTOMER_SELECT,
    });

    // Retiring someone who still owes money is allowed — they may have stopped
    // trading without settling — but the owner should be told, not have the
    // debt quietly disappear from the active list.
    const owes = balance.outstanding.greaterThan(0);

    return ok({
      deleted: "soft" as const,
      customer: serialize(deactivated),
      outstanding: serialize(balance.outstanding),
      message: owes
        ? `"${customer.name}" was deactivated, but still owes ${balance.outstanding.toFixed(2)}. Their history and balance are kept.`
        : `"${customer.name}" was deactivated. Their history is kept.`,
    });
  } catch (error) {
    return serverError("customers.[id].DELETE", error);
  }
}
