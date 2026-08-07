import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { resolveModuleCategoryId } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import {
  SALE_DETAIL_SELECT,
  SALE_PRODUCT_SELECT,
  checkTotalFits,
  isSaleProblem,
  loadSaleProducts,
  reconcileSaleLines,
  sumLineTotals,
} from "@/lib/sales";
import { serialize } from "@/lib/serialize";
import { saleUpdateSchema } from "@/lib/validations/sales";

// Prisma cannot run on Edge (Gotcha 3).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

/**
 * GET /api/bakery/sales/[id]
 *
 * Every figure on a line comes from the line's own stored `unitPrice` /
 * `lineTotal` snapshot — the product join supplies the NAME and the attributes
 * that identify it (tier, shape, unit), and the current `Product.price` is
 * never read here (Gotcha 5).
 */
export async function GET(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const sale = await prisma.bakerySale.findUnique({
      where: { id: params.id },
      select: SALE_DETAIL_SELECT,
    });
    if (!sale) return fail("That sale no longer exists.", 404);

    // Decimals -> numbers at the boundary (Gotcha 2).
    return ok(serialize(sale));
  } catch (error) {
    return serverError("bakery.sales.[id].GET", error);
  }
}

/**
 * PATCH /api/bakery/sales/[id]
 *
 * Body: { saleDate?, notes?, items? }
 *
 * OMIT `items` and only the header changes — every line, and therefore every
 * price snapshot, is left exactly as it was.
 *
 * SEND `items` and it is the COMPLETE desired set of lines: an entry with an
 * `id` is that stored line kept or edited, one without is new, and any stored
 * line absent from the array is removed.
 *
 * The re-snapshot decision is `reconcileSaleLines` in lib/sales.ts — THE single
 * implementation, shared with beverages and deliberately not re-derived here.
 * A new line or a changed PRODUCT re-prices; a quantity-only edit keeps its
 * original snapshot.
 */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = saleUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { saleDate, notes, items } = parsed.data;

    const existing = await prisma.bakerySale.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        items: {
          select: { id: true, productId: true, quantity: true, unitPrice: true },
        },
      },
    });
    if (!existing) return fail("That sale no longer exists.", 404);

    const header: Prisma.BakerySaleUpdateInput = {};
    if (saleDate !== undefined) header.saleDate = saleDate;
    if (notes !== undefined) header.notes = notes ?? null;

    // ----- Header-only edit: lines untouched, nothing to recompute -----------
    if (items === undefined) {
      const sale = await prisma.bakerySale.update({
        where: { id: existing.id },
        data: header,
        select: SALE_DETAIL_SELECT,
      });
      return ok({ ...serialize(sale), repricedItemIds: [] as string[] });
    }

    // ----- Full line reconciliation ------------------------------------------
    const categoryId = await resolveModuleCategoryId("bakery");
    if (!categoryId) {
      return fail(
        "There's no Bakery category in the catalog yet. Add one before editing bakery sales.",
        409
      );
    }

    const products = await loadSaleProducts(
      items.map((item) => item.productId),
      {
        categoryId,
        moduleLabel: "Bakery",
        findMany: (ids) =>
          prisma.product.findMany({
            where: { id: { in: ids } },
            select: SALE_PRODUCT_SELECT,
          }),
      }
    );
    if (isSaleProblem(products)) return fail(products.message, products.status);

    const reconciled = reconcileSaleLines(existing.items, items, products);
    if (isSaleProblem(reconciled)) {
      return fail(reconciled.message, reconciled.status);
    }

    const { updates, creates, removedIds, repricedItemIds } = reconciled;

    const totalAmount = sumLineTotals([...updates, ...creates]);
    const tooLarge = checkTotalFits(totalAmount);
    if (tooLarge) return fail(tooLarge.message, tooLarge.status);

    const sale = await prisma.$transaction(
      async (tx) => {
        if (removedIds.length > 0) {
          // `saleId` in the filter as well as the ids: a scoped delete can never
          // reach a line on someone else's sale, whatever the payload said.
          await tx.bakerySaleItem.deleteMany({
            where: { id: { in: removedIds }, saleId: existing.id },
          });
        }

        for (const update of updates) {
          const { id, ...data } = update;
          await tx.bakerySaleItem.update({ where: { id }, data });
        }

        if (creates.length > 0) {
          await tx.bakerySaleItem.createMany({
            data: creates.map((line) => ({ ...line, saleId: existing.id })),
          });
        }

        // Last, so the returned select sees the reconciled lines.
        return tx.bakerySale.update({
          where: { id: existing.id },
          data: { ...header, totalAmount },
          select: SALE_DETAIL_SELECT,
        });
      },
      {
        // The line updates are one round trip each and a sale may hold up to 100
        // of them. Over a pooled Supabase connection that can outrun Prisma's 5s
        // interactive-transaction default and roll back a legitimate edit.
        timeout: 15_000,
        maxWait: 5_000,
      }
    );

    return ok({ ...serialize(sale), repricedItemIds });
  } catch (error) {
    return serverError("bakery.sales.[id].PATCH", error);
  }
}

/**
 * DELETE /api/bakery/sales/[id]
 *
 * Removes the sale and its lines in one transaction. `BakerySaleItem.sale` is
 * `onDelete: Cascade`, so the database would clear the lines on its own — the
 * explicit ordered delete is the same stance lib/catalog-guards.ts takes: we
 * never let the database decide what goes. Nothing else references a sale, so
 * unlike a Product this is a genuine hard delete with no soft-delete fallback.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const sale = await prisma.bakerySale.findUnique({
      where: { id: params.id },
      select: { id: true, _count: { select: { items: true } } },
    });
    if (!sale) return fail("That sale no longer exists.", 404);

    await prisma.$transaction(async (tx) => {
      await tx.bakerySaleItem.deleteMany({ where: { saleId: sale.id } });
      await tx.bakerySale.delete({ where: { id: sale.id } });
    });

    return ok({
      deleted: "hard" as const,
      id: sale.id,
      itemCount: sale._count.items,
    });
  } catch (error) {
    return serverError("bakery.sales.[id].DELETE", error);
  }
}
