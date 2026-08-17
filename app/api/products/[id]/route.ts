import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { productHasSaleHistory } from "@/lib/catalog-guards";
import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import { productUpdateSchema } from "@/lib/validations/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

const PRODUCT_SELECT = {
  // Migration E — see the create route.
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
 * PATCH /api/products/[id]
 *
 * Edits the product, including the inline price editor (which sends `{ price }`
 * on its own). Also the reactivate path: `{ isActive: true }`.
 *
 * Changing `price` here CANNOT alter any past sale. Sale lines store their own
 * `unitPrice` snapshot taken at the time of sale (Gotcha 5) and no report ever
 * re-joins to Product.price, so historical totals are unaffected by design.
 */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = productUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const existing = await prisma.product.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) return fail("That product no longer exists.", 404);

    if (parsed.data.subCategoryId) {
      const subCategory = await prisma.subCategory.findUnique({
        where: { id: parsed.data.subCategoryId },
        select: { id: true },
      });
      if (!subCategory) return fail("That sub-category no longer exists.", 404);
    }

    const { units, ...fields } = parsed.data;

    /**
     * SELLING UNITS ARE REPLACE-ALL (S8), inside ONE transaction with the
     * product update — the same contract a sale's `items` uses.
     *
     * Omitting `units` leaves the existing ones alone, which is what the inline
     * price and stock editors do when they PATCH a single field. Sending an
     * array replaces the set; sending `[]` clears it and the product goes back
     * to selling in base units.
     *
     * Delete-then-create rather than a diff: a unit carries no history of its
     * own — every sold line has ALREADY snapshotted the name and factor it was
     * sold at (`SaleItem.unitName` / `unitFactor`), so rewriting the catalog's
     * rows cannot disturb a single past bill.
     */
    const product = await prisma.$transaction(async (tx) => {
      if (units !== undefined) {
        await tx.productUnit.deleteMany({ where: { productId: params.id } });
        if (units.length > 0) {
          await tx.productUnit.createMany({
            data: units.map((unit) => ({ ...unit, productId: params.id })),
          });
        }
      }
      return tx.product.update({
        where: { id: params.id },
        data: fields,
        select: PRODUCT_SELECT,
      });
    }, { timeout: 15_000, maxWait: 5_000 });

    return ok(serialize(product));
  } catch (error) {
    return serverError("products.PATCH", error);
  }
}

/**
 * DELETE /api/products/[id]
 *
 * Soft-delete when the product has sale history (isActive = false, row kept so
 * past sale lines still resolve a name); hard-delete when it is clean. The
 * response says which happened so the UI can word its toast accurately —
 * "Deactivated" is not the same news as "Deleted".
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const product = await prisma.product.findUnique({
      where: { id: params.id },
      select: { id: true, name: true },
    });
    if (!product) return fail("That product no longer exists.", 404);

    if (await productHasSaleHistory(product.id)) {
      const deactivated = await prisma.product.update({
        where: { id: product.id },
        data: { isActive: false },
        select: PRODUCT_SELECT,
      });

      return ok({
        deleted: "soft" as const,
        product: serialize(deactivated),
        message: `"${product.name}" has sales recorded against it, so it was deactivated instead of deleted. Past sales are unchanged.`,
      });
    }

    await prisma.product.delete({ where: { id: product.id } });

    return ok({ deleted: "hard" as const, id: product.id, product: null });
  } catch (error) {
    return serverError("products.DELETE", error);
  }
}
