import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { buildDeleteRefusal, findProductsWithSaleHistory } from "@/lib/catalog-guards";
import { prisma } from "@/lib/prisma";
import { subCategoryUpdateSchema } from "@/lib/validations/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

/** PATCH /api/subcategories/[id] — rename, and/or move to another category. */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = subCategoryUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const existing = await prisma.subCategory.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) return fail("That sub-category no longer exists.", 404);

    if (parsed.data.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: parsed.data.categoryId },
        select: { id: true },
      });
      if (!category) return fail("That category no longer exists.", 404);
    }

    const subCategory = await prisma.subCategory.update({
      where: { id: params.id },
      data: parsed.data,
    });

    return ok(subCategory);
  } catch (error) {
    return serverError("subcategories.PATCH", error);
  }
}

/**
 * DELETE /api/subcategories/[id]
 *
 * Same guarded hard-delete as the category route, one level down: allowed only
 * when no product beneath it carries sale history. Clean products go with it in
 * one transaction; otherwise 409 with the "deactivate instead" message.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const subCategory = await prisma.subCategory.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, products: { select: { id: true } } },
    });
    if (!subCategory) return fail("That sub-category no longer exists.", 404);

    const productIds = subCategory.products.map((product) => product.id);

    const blocking = await findProductsWithSaleHistory(productIds);
    if (blocking.length > 0) {
      return fail(buildDeleteRefusal(subCategory.name, blocking), 409);
    }

    await prisma.$transaction([
      prisma.product.deleteMany({ where: { subCategoryId: subCategory.id } }),
      prisma.subCategory.delete({ where: { id: subCategory.id } }),
    ]);

    return ok({
      id: subCategory.id,
      deleted: "hard" as const,
      deletedProducts: productIds.length,
    });
  } catch (error) {
    return serverError("subcategories.DELETE", error);
  }
}
