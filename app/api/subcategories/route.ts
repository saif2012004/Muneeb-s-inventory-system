import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { subCategoryCreateSchema } from "@/lib/validations/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/subcategories — add a brand or product line under a category. */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = subCategoryCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { name, categoryId } = parsed.data;

    // Checked explicitly so a bad categoryId reads as "that category no longer
    // exists" rather than surfacing a raw foreign-key violation.
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) return fail("That category no longer exists.", 404);

    const duplicate = await prisma.subCategory.findFirst({
      where: { categoryId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) {
      return fail(`"${name}" already exists in this category.`, 409);
    }

    const subCategory = await prisma.subCategory.create({
      data: { name, categoryId },
    });

    return ok({ ...subCategory, productCount: 0 }, 201);
  } catch (error) {
    return serverError("subcategories.POST", error);
  }
}
