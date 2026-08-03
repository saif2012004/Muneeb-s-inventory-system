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
 * GET /api/beverages/sales/[id]
 *
 * The sale with its line items. Every figure on a line comes from the line's
 * own stored `unitPrice` / `lineTotal` snapshot — the product join supplies the
 * NAME only, and the current `Product.price` is never read here (Gotcha 5).
 */
export async function GET(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const sale = await prisma.beverageSale.findUnique({
      where: { id: params.id },
      select: SALE_DETAIL_SELECT,
    });
    if (!sale) return fail("That sale no longer exists.", 404);

    // Decimals -> numbers at the boundary (Gotcha 2).
    return ok(serialize(sale));
  } catch (error) {
    return serverError("beverages.sales.[id].GET", error);
  }
}

/**
 * PATCH /api/beverages/sales/[id]
 *
 * Body: { saleDate?, notes?, items? }
 *
 * ---------------------------------------------------------------------------
 * WHAT `items` MEANS
 * ---------------------------------------------------------------------------
 * OMIT `items` entirely and only the header changes. Every line, and therefore
 * every price snapshot, is left exactly as it was. This is the safe edit.
 *
 * SEND `items` and it is the COMPLETE desired set of lines:
 *   - an entry WITH an `id`    -> that existing line, kept or edited
 *   - an entry WITHOUT an `id` -> a new line to add
 *   - an existing line absent from the array -> removed from the sale
 *
 * ---------------------------------------------------------------------------
 * RE-SNAPSHOT RULE (see "Price snapshot" in CLAUDE.md)
 * ---------------------------------------------------------------------------
 * A new line, or one whose PRODUCT changed, takes a fresh snapshot of the
 * current `Product.price`. A line whose quantity alone changed KEEPS its
 * original snapshot, as does an untouched one — a quantity correction is a typo
 * fix, not a re-sale, and must never move a historical total. An explicit
 * `unitPrice` on the line overrides all of it.
 *
 * The decision itself is `reconcileSaleLines` in lib/sales.ts; the response
 * reports which lines were genuinely re-priced via `repricedItemIds`.
 *
 * All of it commits in ONE interactive transaction: deletes, updates, inserts
 * and the recomputed `totalAmount` land together or not at all.
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

    const existing = await prisma.beverageSale.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPrice: true,
          },
        },
      },
    });
    if (!existing) return fail("That sale no longer exists.", 404);

    const header: Prisma.BeverageSaleUpdateInput = {};
    if (saleDate !== undefined) header.saleDate = saleDate;
    if (notes !== undefined) header.notes = notes ?? null;

    // ----- Header-only edit: lines untouched, nothing to recompute -----------
    if (items === undefined) {
      const sale = await prisma.beverageSale.update({
        where: { id: existing.id },
        data: header,
        select: SALE_DETAIL_SELECT,
      });
      return ok({ ...serialize(sale), repricedItemIds: [] as string[] });
    }

    // ----- Full line reconciliation ------------------------------------------
    const categoryId = await resolveModuleCategoryId("beverages");
    if (!categoryId) {
      return fail(
        "There's no Beverages category in the catalog yet. Add one before editing beverage sales.",
        409
      );
    }

    const products = await loadSaleProducts(
      items.map((item) => item.productId),
      {
        categoryId,
        moduleLabel: "Beverages",
        findMany: (ids) =>
          prisma.product.findMany({
            where: { id: { in: ids } },
            select: SALE_PRODUCT_SELECT,
          }),
      }
    );
    if (isSaleProblem(products)) return fail(products.message, products.status);

    // The snapshot decision — which lines keep their stored price and which take
    // a fresh one — lives in lib/sales.ts as a pure function.
    const reconciled = reconcileSaleLines(existing.items, items, products);
    if (isSaleProblem(reconciled)) {
      return fail(reconciled.message, reconciled.status);
    }

    const { updates, creates, removedIds, repricedItemIds } = reconciled;

    const totalAmount = sumLineTotals([...updates, ...creates]);
    const tooLarge = checkTotalFits(totalAmount);
    if (tooLarge) return fail(tooLarge.message, tooLarge.status);

    const sale = await prisma.$transaction(async (tx) => {
      if (removedIds.length > 0) {
        // `saleId` in the filter as well as the ids: a scoped delete can never
        // reach a line on someone else's sale, whatever the payload said.
        await tx.beverageSaleItem.deleteMany({
          where: { id: { in: removedIds }, saleId: existing.id },
        });
      }

      for (const update of updates) {
        const { id, ...data } = update;
        await tx.beverageSaleItem.update({ where: { id }, data });
      }

      if (creates.length > 0) {
        await tx.beverageSaleItem.createMany({
          data: creates.map((line) => ({ ...line, saleId: existing.id })),
        });
      }

      // Last, so the returned select sees the reconciled lines.
      return tx.beverageSale.update({
        where: { id: existing.id },
        data: { ...header, totalAmount },
        select: SALE_DETAIL_SELECT,
      });
    }, {
      // The line updates are one round trip each and a sale may hold up to 100
      // of them. Over a pooled Supabase connection that can outrun Prisma's 5s
      // interactive-transaction default and roll back a legitimate edit.
      timeout: 15_000,
      maxWait: 5_000,
    });

    return ok({ ...serialize(sale), repricedItemIds });
  } catch (error) {
    return serverError("beverages.sales.[id].PATCH", error);
  }
}

/**
 * DELETE /api/beverages/sales/[id]
 *
 * Removes the sale and its lines in one transaction.
 *
 * `BeverageSaleItem.sale` is declared `onDelete: Cascade`, so the database
 * would clear the lines on its own — the explicit ordered delete is the same
 * stance lib/catalog-guards.ts takes: we never let the database decide what
 * goes. Nothing else references a sale, so unlike a Product this is a genuine
 * hard delete with no soft-delete fallback.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const sale = await prisma.beverageSale.findUnique({
      where: { id: params.id },
      select: { id: true, _count: { select: { items: true } } },
    });
    if (!sale) return fail("That sale no longer exists.", 404);

    await prisma.$transaction(async (tx) => {
      await tx.beverageSaleItem.deleteMany({ where: { saleId: sale.id } });
      await tx.beverageSale.delete({ where: { id: sale.id } });
    });

    return ok({ deleted: "hard" as const, id: sale.id, itemCount: sale._count.items });
  } catch (error) {
    return serverError("beverages.sales.[id].DELETE", error);
  }
}
