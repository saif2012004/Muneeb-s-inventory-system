/**
 * Delete safety for the catalog. THE single implementation — the category,
 * sub-category and product DELETE handlers all route through here so the rule
 * cannot drift between them.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * Sale history is sacred. A `SaleItem` holds a snapshot of the price at the time
 * of sale (Gotcha 5), and a past sale must stay readable forever. So nothing
 * that a sale line points at is ever hard-deleted.
 *
 * ⚠️ FIXED IN S9: this file used to check ONLY the old per-module item tables,
 * which stopped being the whole truth the moment the unified till went live in
 * S4.2. A product sold only on the till therefore read as having no history, and
 * deleting it was attempted as a HARD delete — which the `SaleItem.productId`
 * foreign key then rejected, turning a case that should have been a friendly
 * "deactivate it instead" into a 500. It now reads `SaleItem`, which since
 * Migration B is where every sale line lives.
 *
 *   Product          -> soft-delete (isActive = false) if it has sale history,
 *                       hard-delete only when it is clean.
 *   SubCategory      -> hard-delete only if NOTHING beneath it has sale
 *   Category            history. Clean children go with it in one transaction.
 *                       Otherwise REFUSE (409) and tell the owner to
 *                       deactivate the offending products instead.
 *
 * There is deliberately no cascade path that could reach a sale row. Note that
 * SubCategory.category is declared `onDelete: Cascade` in schema.prisma, which
 * is why every delete below is an explicit, ordered transaction rather than a
 * single `category.delete()` — we never let the database decide what goes.
 */
import { prisma } from "@/lib/prisma";

/**
 * A product that is referenced by at least one sale line.
 *
 * `id` is what makes this actionable: the client can offer "deactivate these"
 * and PATCH by id, instead of trying to parse names back out of the prose
 * message. The message stays for display; this is for behaviour.
 */
export type BlockingProduct = { id: string; name: string; saleCount: number };

/**
 * Which of these products appear on a sale line, and on how many. Returns []
 * for an empty input without querying.
 */
export async function findProductsWithSaleHistory(
  productIds: string[]
): Promise<BlockingProduct[]> {
  if (productIds.length === 0) return [];

  // groupBy rather than findMany+distinct: we need the per-product line count,
  // not just which ids appear.
  const groups = await prisma.saleItem.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds } },
    _count: { _all: true },
  });

  const countsById = new Map<string, number>();
  for (const group of groups) {
    countsById.set(group.productId, group._count._all);
  }
  if (countsById.size === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: Array.from(countsById.keys()) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return products.map((product) => ({
    ...product,
    saleCount: countsById.get(product.id) ?? 0,
  }));
}

/** True when this single product appears on any sale line. */
export async function productHasSaleHistory(productId: string): Promise<boolean> {
  return (await prisma.saleItem.count({ where: { productId } })) > 0;
}

/**
 * The 409 message shown to the owner. Names up to three products so the
 * message stays readable when a whole category is blocked.
 *
 * Phrased as an instruction, not an error: the owner's next action is to
 * deactivate those products, and the message has to say so.
 */
export function buildDeleteRefusal(
  label: string,
  blocking: BlockingProduct[]
): string {
  const MAX_NAMED = 3;
  const named = blocking.slice(0, MAX_NAMED).map((product) => product.name);
  const remainder = blocking.length - named.length;

  const list =
    remainder > 0
      ? `${named.join(", ")} and ${remainder} more`
      : named.join(", ");

  const subject =
    blocking.length === 1 ? "1 product has" : `${blocking.length} products have`;

  return (
    `Can't delete "${label}" — ${subject} sales recorded against it (${list}). ` +
    `Deactivate those products instead so past sales stay intact.`
  );
}
