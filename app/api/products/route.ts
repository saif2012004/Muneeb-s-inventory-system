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
  // Migration F — the selling units this product may be sold in (S8).
  units: {
    select: { id: true, name: true, baseFactor: true, price: true, isDefault: true },
    orderBy: { baseFactor: "asc" },
  },
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
  /**
   * ⚠️ `createdAt` / `updatedAt` are NOT selected, deliberately.
   *
   * Nothing in the UI reads them — grep `components/catalog` and
   * `components/sales`. They were 75 × two ISO strings on the catalog's list
   * response for nobody.
   *
   * That matters more than it sounds. Measured 2026-08-19: row COUNT is free
   * (75 products by id costs the same 218ms as one row), but PAYLOAD is not —
   * the same 75 products with their relations took 944ms, because ~45KB over a
   * 230ms link is bounded by round trips, not bandwidth. Dead fields are paid
   * for on every catalog and till load.
   *
   * If a screen ever needs them, add them back to a narrower endpoint rather
   * than to this list.
   */
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

    const { subCategoryId, units, ...rest } = parsed.data;

    const subCategory = await prisma.subCategory.findUnique({
      where: { id: subCategoryId },
      select: { id: true },
    });
    if (!subCategory) return fail("That sub-category no longer exists.", 404);

    const product = await prisma.product.create({
      // Selling units (S8) are created with the product in ONE statement — a
      // nested create, not a second round trip, which matters at ~1.1s each.
      data: {
        ...rest,
        subCategoryId,
        ...(units && units.length > 0 ? { units: { create: units } } : {}),
      },
      select: PRODUCT_SELECT,
    });

    return ok(serialize(product), 201);
  } catch (error) {
    return serverError("products.POST", error);
  }
}
