import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { buildDeleteRefusal, findProductsWithSaleHistory } from "@/lib/catalog-guards";
import { prisma } from "@/lib/prisma";
import { categoryUpdateSchema } from "@/lib/validations/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 14 hands the route a PLAIN params object. (Next 15 changed this to a
// Promise — that pattern does not apply here.)
type Context = { params: { id: string } };

/** PATCH /api/categories/[id] — rename. */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = categoryUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const existing = await prisma.category.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) return fail("That category no longer exists.", 404);

    const category = await prisma.category.update({
      where: { id: params.id },
      data: { name: parsed.data.name },
    });

    return ok(category);
  } catch (error) {
    return serverError("categories.PATCH", error);
  }
}

/**
 * DELETE /api/categories/[id]
 *
 * Guarded hard-delete. See lib/catalog-guards.ts for the rule: this only
 * succeeds when NOTHING beneath the category has sale history. When it does
 * succeed it removes the category, its sub-categories and their products in a
 * single transaction — never a database cascade, which could not enforce the
 * check. When it doesn't, it refuses with 409 and names the blocking products.
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const category = await prisma.category.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        subCategories: {
          select: { id: true, products: { select: { id: true } } },
        },
      },
    });
    if (!category) return fail("That category no longer exists.", 404);

    const subCategoryIds = category.subCategories.map((sub) => sub.id);
    const productIds = category.subCategories.flatMap((sub) =>
      sub.products.map((product) => product.id)
    );

    const blocking = await findProductsWithSaleHistory(productIds);
    if (blocking.length > 0) {
      return fail(buildDeleteRefusal(category.name, blocking), 409);
    }

    // Children first — Product -> SubCategory is Restrict, so the order is
    // load-bearing, not cosmetic.
    await prisma.$transaction([
      prisma.product.deleteMany({
        where: { subCategoryId: { in: subCategoryIds } },
      }),
      prisma.subCategory.deleteMany({ where: { categoryId: category.id } }),
      prisma.category.delete({ where: { id: category.id } }),
    ]);

    return ok({
      id: category.id,
      deleted: "hard" as const,
      deletedSubCategories: subCategoryIds.length,
      deletedProducts: productIds.length,
    });
  } catch (error) {
    return serverError("categories.DELETE", error);
  }
}
