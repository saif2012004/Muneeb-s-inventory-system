/**
 * Delete safety for the catalog. THE single implementation — the category,
 * sub-category and product DELETE handlers all route through here so the rule
 * cannot drift between them.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * Sale history is sacred. A BeverageSaleItem / BakerySaleItem holds a snapshot
 * of the price at the time of sale (Gotcha 5), and a past sale must stay
 * readable forever. So nothing that a sale line points at is ever hard-deleted.
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

/** A product that is referenced by at least one sale line. */
export type BlockingProduct = { id: string; name: string };

/**
 * Which of these products appear on a beverage or bakery sale line.
 * Returns [] for an empty input without querying.
 */
export async function findProductsWithSaleHistory(
  productIds: string[]
): Promise<BlockingProduct[]> {
  if (productIds.length === 0) return [];

  const [beverageItems, bakeryItems] = await Promise.all([
    prisma.beverageSaleItem.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true },
      distinct: ["productId"],
    }),
    prisma.bakerySaleItem.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true },
      distinct: ["productId"],
    }),
  ]);

  const blockedIds = Array.from(
    new Set([
      ...beverageItems.map((item) => item.productId),
      ...bakeryItems.map((item) => item.productId),
    ])
  );
  if (blockedIds.length === 0) return [];

  return prisma.product.findMany({
    where: { id: { in: blockedIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** True when this single product appears on any sale line. */
export async function productHasSaleHistory(productId: string): Promise<boolean> {
  const [beverageCount, bakeryCount] = await Promise.all([
    prisma.beverageSaleItem.count({ where: { productId } }),
    prisma.bakerySaleItem.count({ where: { productId } }),
  ]);
  return beverageCount + bakeryCount > 0;
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
