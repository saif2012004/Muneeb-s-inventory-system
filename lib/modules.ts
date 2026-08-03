/**
 * Which catalog Category backs each business module.
 *
 * A beverage sale may only contain Beverages products, and a bakery sale only
 * Bakery products. Nothing in the schema enforces that — Product hangs off
 * SubCategory hangs off Category, and any product id would satisfy the foreign
 * key — so the sale routes have to check it themselves.
 *
 * Resolution is by SEEDED ID FIRST, falling back to a case-insensitive name
 * match. The ids below are the deterministic ones from prisma/seed.ts. The
 * fallback matters because the owner can rename a category in the catalog UI,
 * and could in principle delete the seeded one and make their own — the id
 * lookup keeps the normal case to a single indexed query, the name lookup keeps
 * the module working if they did.
 *
 * We deliberately do NOT import CATEGORIES from prisma/seed.ts: that module
 * constructs its own PrismaClient at import time, which would open a second
 * connection pool inside every serverless function that touched it.
 */
import { prisma } from "@/lib/prisma";

export const MODULE_CATEGORIES = {
  beverages: { seedId: "cat_beverages", name: "Beverages" },
  bakery: { seedId: "cat_bakery", name: "Bakery" },
} as const;

export type ModuleKey = keyof typeof MODULE_CATEGORIES;

/**
 * The Category id backing a module, or null if the owner has removed it
 * entirely. Callers should treat null as a 409 ("set the category up first"),
 * not a 500 — it is a recoverable catalog state, not a bug.
 */
export async function resolveModuleCategoryId(
  module: ModuleKey
): Promise<string | null> {
  const { seedId, name } = MODULE_CATEGORIES[module];

  const seeded = await prisma.category.findUnique({
    where: { id: seedId },
    select: { id: true },
  });
  if (seeded) return seeded.id;

  const byName = await prisma.category.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return byName?.id ?? null;
}
