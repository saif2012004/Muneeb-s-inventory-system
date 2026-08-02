import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { categoryCreateSchema } from "@/lib/validations/catalog";

// Prisma cannot run on Edge (Gotcha 3).
export const runtime = "nodejs";
// `auth()` reads cookies so this is dynamic anyway; stated explicitly so a
// future edit can't accidentally let Next cache the catalog tree.
export const dynamic = "force-dynamic";

/**
 * GET /api/categories
 *
 * The catalog tree: categories -> sub-categories, each with a product count.
 * Products themselves come from /api/products so the tree stays small and the
 * "show inactive" toggle only refetches the list.
 *
 * No Decimal fields are returned here, so no serializer is needed.
 */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const categories = await prisma.category.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        subCategories: {
          orderBy: { name: "asc" },
          include: {
            _count: { select: { products: true } },
          },
        },
      },
    });

    return ok(
      categories.map((category) => ({
        id: category.id,
        name: category.name,
        createdAt: category.createdAt,
        subCategories: category.subCategories.map((subCategory) => ({
          id: subCategory.id,
          name: subCategory.name,
          categoryId: subCategory.categoryId,
          productCount: subCategory._count.products,
        })),
      }))
    );
  } catch (error) {
    return serverError("categories.GET", error);
  }
}

/** POST /api/categories — create a top-level category. */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = categoryCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { name } = parsed.data;

    // Category.name is not unique in the schema, so this is a friendliness
    // check rather than a constraint — it stops the owner creating a second
    // "Bakery" by accident. `mode: "insensitive"` so case alone isn't enough.
    const existing = await prisma.category.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return fail(`A category named "${name}" already exists.`, 409);

    const category = await prisma.category.create({ data: { name } });

    return ok({ ...category, subCategories: [] }, 201);
  } catch (error) {
    return serverError("categories.POST", error);
  }
}
