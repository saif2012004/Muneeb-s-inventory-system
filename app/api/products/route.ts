import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import { productCreateSchema } from "@/lib/validations/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shared shape so list and detail responses never drift. */
const PRODUCT_SELECT = {
  // Migration E — the owner sets this per beverage size; the till reads it.
  coolingCharge: true,
  id: true,
  name: true,
  price: true,
  stock: true,
  size: true,
  qualityTier: true,
  shape: true,
  unit: true,
  isActive: true,
  subCategoryId: true,
  createdAt: true,
  updatedAt: true,
  subCategory: {
    select: {
      id: true,
      name: true,
      category: { select: { id: true, name: true } },
    },
  },
} as const;

/**
 * GET /api/products
 *
 * Query params (all optional):
 *   categoryId       restrict to one category
 *   subCategoryId    restrict to one sub-category
 *   search           case-insensitive name match
 *   includeInactive  "true" to include deactivated products
 *
 * Inactive products are hidden by default — the catalog UI's "show inactive"
 * toggle is what flips this, so deactivated items stay reachable and can be
 * reactivated rather than being lost.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId");
    const subCategoryId = searchParams.get("subCategoryId");
    const search = searchParams.get("search")?.trim();
    const includeInactive = searchParams.get("includeInactive") === "true";

    const products = await prisma.product.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(subCategoryId ? { subCategoryId } : {}),
        ...(categoryId ? { subCategory: { categoryId } } : {}),
        ...(search
          ? { name: { contains: search, mode: "insensitive" as const } }
          : {}),
      },
      select: PRODUCT_SELECT,
      orderBy: [{ subCategory: { name: "asc" } }, { name: "asc" }],
    });

    // `price` is a Decimal — an OBJECT, not a number (Gotcha 2). Serializing
    // here is what stops the price editor doing string concatenation.
    return ok(serialize(products));
  } catch (error) {
    return serverError("products.GET", error);
  }
}

/** POST /api/products — create a product. Price defaults to 0 if omitted. */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = productCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { subCategoryId, ...rest } = parsed.data;

    const subCategory = await prisma.subCategory.findUnique({
      where: { id: subCategoryId },
      select: { id: true },
    });
    if (!subCategory) return fail("That sub-category no longer exists.", 404);

    const product = await prisma.product.create({
      data: { ...rest, subCategoryId },
      select: PRODUCT_SELECT,
    });

    return ok(serialize(product), 201);
  } catch (error) {
    return serverError("products.POST", error);
  }
}
