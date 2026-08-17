import { Prisma } from "@prisma/client";

import { MODULE_CATEGORIES, type ModuleKey } from "@/lib/modules";
import {
  SALE_DETAIL_SELECT,
  SALE_LIST_SELECT,
  checkAllProductsResolved,
  checkNoInactiveProducts,
  isSaleProblem,
  toSaleListRow,
  type SaleProblem,
  type SaleProduct,
} from "@/lib/sales";

/**
 * The UNIFIED sale — one bill that may hold beverage, bakery and (later) milk
 * lines together.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS DIFFERS FROM THE PER-MODULE PATH, AND WHY BOTH EXIST
 * ---------------------------------------------------------------------------
 * `loadSaleProducts` in `lib/sales.ts` enforces ONE category per sale — that is
 * its entire purpose, and it must keep doing it for `/api/beverages/sales` and
 * `/api/bakery/sales`. This module is the opposite: any category is allowed, and
 * each line records WHICH one it was sold as, in `SaleItem.moduleKey`.
 *
 * The two loaders share the checks that are genuinely identical (a missing id, a
 * deactivated product) via `checkAllProductsResolved` / `checkNoInactiveProducts`,
 * so the sentence the owner reads exists once. They do NOT share the category
 * rule, because they disagree about it on purpose.
 *
 * Nothing here removes or rewires the per-module routes. Both paths are live.
 */

/**
 * Like `SALE_PRODUCT_SELECT`, plus the product's Category id AND name.
 *
 * The extra nesting is a JOIN, not a second query — which is the whole reason
 * `moduleKey` resolution costs ZERO extra round trips. At ~1.1s per round trip
 * (see CLAUDE.md) a separate category lookup per sale would have been a real
 * second of the owner's time for information already on the row.
 */
export const UNIFIED_SALE_PRODUCT_SELECT = {
  id: true,
  name: true,
  price: true,
  stock: true,
  isActive: true,
  // Migration E. Rides along in the select the route already runs, so the
  // cooling charge costs ZERO extra round trips — same reasoning as `stock`.
  coolingCharge: true,
  // Migration F (S8). A JOIN on the same query: the selling units a line may be
  // sold in, with the price and base-unit factor of each.
  units: {
    select: { name: true, baseFactor: true, price: true, isDefault: true },
    orderBy: { baseFactor: "asc" },
  },
  subCategory: {
    select: {
      categoryId: true,
      category: { select: { id: true, name: true } },
    },
  },
} as const;

/** A raw row from {@link UNIFIED_SALE_PRODUCT_SELECT}. `stock` is Decimal since Migration D. */
export type UnifiedSaleProductRow = {
  id: string;
  name: string;
  price: Prisma.Decimal;
  stock: Prisma.Decimal | number;
  isActive: boolean;
  /** NULL = never chilled, so no toggle. See the schema. */
  coolingCharge: Prisma.Decimal | null;
  units: {
    name: string;
    baseFactor: Prisma.Decimal;
    price: Prisma.Decimal;
    isDefault: boolean;
  }[];
  subCategory: { categoryId: string; category: { id: string; name: string } };
};

/**
 * A resolved product, carrying the module its line will be recorded under and
 * the cooling charge the till may apply.
 *
 * 🔒 THE RATE COMES FROM HERE — THE SERVER — NEVER FROM THE CLIENT. The till
 * sends only `chilled: true/false`; the amount is read off the catalog row. A
 * client-supplied rate would be a second price channel to police, and the whole
 * point of the owner's instruction ("the cooling charges has to be added from
 * the catalog") is that there is one place the number lives.
 */
export type UnifiedSaleProduct = SaleProduct & {
  moduleKey: ModuleKey;
  coolingCharge: Prisma.Decimal | null;
  /**
   * The SELLING UNITS this product may be sold in (S8). Empty = base units only.
   *
   * 🔒 PRICE AND FACTOR COME FROM HERE — THE SERVER. The till sends the unit's
   * NAME; it never sends a factor, and a wrong factor is the one thing that
   * could silently drain stock (a peti recorded as 1 egg, or 360 taken for a
   * dozen). Same stance as the cooling rate.
   */
  units: {
    name: string;
    baseFactor: Prisma.Decimal;
    price: Prisma.Decimal;
    isDefault: boolean;
  }[];
};

/**
 * Which module a line belongs to, from its product's Category.
 *
 * SEEDED ID FIRST, then a case-insensitive NAME match — the same two-step rule
 * `resolveModuleCategoryId` already uses, and for the same reason: the owner can
 * rename a category in the catalog UI, or delete the seeded one and make their
 * own, and the sale must keep working either way.
 *
 * Returns null for a category that backs no module, which the route turns into a
 * 409 rather than guessing. Guessing here would mis-attribute revenue for the
 * life of the record — `moduleKey` is a SNAPSHOT and is never recomputed.
 *
 * `"milk"` resolves through this function with no change the moment a Milk Shop
 * category exists; today `cat_milk` matches nothing. See MODULE_CATEGORIES.
 */
export function resolveLineModule(category: {
  id: string;
  name: string;
}): ModuleKey | null {
  const entries = Object.entries(MODULE_CATEGORIES) as [
    ModuleKey,
    (typeof MODULE_CATEGORIES)[ModuleKey],
  ][];

  for (const [key, def] of entries) {
    if (category.id === def.seedId) return key;
  }
  for (const [key, def] of entries) {
    if (category.name.toLowerCase() === def.name.toLowerCase()) return key;
  }
  return null;
}

/**
 * Load every product on a unified sale and resolve each one's module.
 *
 * Fails the same three ways as the per-module loader, with the category check
 * replaced by a per-line resolution:
 *   - an id does not exist                     -> 404 (shared check)
 *   - a product is deactivated                 -> 400 (shared check)
 *   - a product's category backs no module     -> 409
 *
 * The 409 is deliberate rather than a 400: the request is well-formed and the
 * product is real — the CATALOG is in a state the sale cannot express, which the
 * owner fixes by moving the product into a proper category. Same reasoning as
 * `resolveModuleCategoryId` returning null being a 409.
 */
export async function loadUnifiedSaleProducts(
  productIds: string[],
  findMany: (ids: string[]) => Promise<UnifiedSaleProductRow[]>
): Promise<Map<string, UnifiedSaleProduct> | SaleProblem> {
  const unique = Array.from(new Set(productIds));
  const rows = await findMany(unique);

  // Normalise stock Decimal -> number at this boundary, exactly as
  // `toSaleProduct` does for the per-module path (Gotcha 2 / Migration D).
  const products: SaleProduct[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    stock: Number(row.stock),
    isActive: row.isActive,
    subCategory: { categoryId: row.subCategory.categoryId },
  }));
  const byId = new Map(products.map((product) => [product.id, product]));

  const unresolved = checkAllProductsResolved(unique, byId);
  if (unresolved) return unresolved;

  const inactive = checkNoInactiveProducts(products);
  if (inactive) return inactive;

  const resolved = new Map<string, UnifiedSaleProduct>();
  for (const row of rows) {
    const moduleKey = resolveLineModule(row.subCategory.category);
    if (!moduleKey) {
      return {
        message: `"${row.name}" is in a category that isn't set up for sales. Move it under Beverages, Bakery or Milk Shop in the catalog first.`,
        status: 409,
      };
    }
    resolved.set(row.id, {
      ...byId.get(row.id)!,
      moduleKey,
      coolingCharge: row.coolingCharge,
      units: row.units,
    });
  }

  return resolved;
}

export { isSaleProblem };

/**
 * The unified sale shape returned by create.
 *
 * A SUPERSET of `SALE_DETAIL_SELECT` — spread rather than retyped so the shared
 * fields cannot drift. The two additions are the columns that only exist on the
 * unified tables:
 *
 *   moduleKey     what this line was SOLD AS, snapshotted (never re-derived)
 *   netLineTotal  the line's contribution to the bill total
 *
 * ⚠️ `SALE_DETAIL_SELECT`'s generic name makes it look like it already covers
 * this table. It does not — it was written for BeverageSale/BakerySale, which
 * have neither column. See the warning in CLAUDE.md.
 */
export const UNIFIED_SALE_DETAIL_SELECT = {
  ...SALE_DETAIL_SELECT,
  items: {
    select: {
      ...SALE_DETAIL_SELECT.items.select,
      moduleKey: true,
      netLineTotal: true,
      // The rate actually charged on this line, snapshotted (Migration E). The
      // receipt and the detail view read it; neither recomputes it from the
      // catalog, which would let a later change move a printed bill.
      coolingRate: true,
      // What this line was SOLD AS and what stock moved by (Migration F).
      unitName: true,
      unitFactor: true,
    },
    // cuid is time-prefixed, so id order is insertion order.
    orderBy: { id: "asc" },
  },
} as const;

/**
 * 🔴 THE MIGRATED-COPY DEDUPE, IN ONE PLACE. Every aggregate over `Sale` needs it.
 *
 * A sale that exists in BOTH an old per-module table and `Sale` is ONE sale that
 * has been copied, not two sales. Migration A did this for the pre-existing
 * per-module sales, KEEPING each one's original id — so `Sale` holds a row
 * (`cmsjh3kly0002uve8ajkvs2ji`) whose twin is still live in `BakerySale`. Any
 * total that sums `Sale` ON TOP OF the old tables counts that Rs. 5,000 twice:
 * the customer's balance, the period's revenue, a product's units sold.
 *
 * Matching by id is exact rather than heuristic — a genuinely new unified sale
 * gets a fresh cuid and cannot collide — and it is SELF-HEALING: it excludes
 * exactly the rows that are duplicated right now, and 0 once S9 drops the old
 * tables. There is nothing to remember to undo.
 *
 * ⚠️ `MilkSale` IS IN THE LIST DELIBERATELY, AHEAD OF ITS COPY EXISTING.
 * S5 will copy the real milk sale into `Sale` the same way — same id — and the
 * moment it lands, every balance and every revenue figure would count its
 * Rs. 6,000 twice unless this already excluded it. The guard is a NO-OP until
 * then (no `Sale` row shares an id with a `MilkSale` row today), which is
 * exactly why it ships FIRST: the data step must never be the thing that makes
 * the numbers wrong for however long the code takes to follow.
 *
 * ⚠️ THE SQL ASSUMES THE `Sale` TABLE IS ALIASED `s`. Every caller aliases it
 * that way; if you write a query that does not, alias it rather than editing
 * this — one definition is the point. Lives here rather than in
 * `lib/receivables.ts` or `lib/reports.ts` because BOTH need it and a rule with
 * two copies is a rule that will disagree with itself.
 */
/**
 * 🔴 A FUNCTION, NOT A CONST — and that is load-bearing, not style.
 *
 * As a top-level `const` this called `Prisma.sql` AT MODULE EVALUATION. Module
 * evaluation happens wherever the module is bundled, and `lib/reports.ts`
 * imports this while ALSO exporting constants that client components read
 * (`REPORT_PERIODS`, the period labels). That dragged the fragment into the
 * browser bundle, where `Prisma.sql` cannot run:
 *
 *     Unhandled Runtime Error
 *     sqltag is unable to run in this browser environment
 *
 * — and the whole `/reports` page died on hydration. Tree-shaking cannot save a
 * top-level call with a side effect; deferring it into a function can, because
 * nothing executes unless a server path calls it.
 *
 * Found by OPENING THE PAGE. `tsc`, `next lint`, `npm run build` and every API
 * test passed with the page broken, because the server render succeeded and only
 * hydration threw. This is the "verify in a real browser" rule in CLAUDE.md
 * earning its place again.
 */
export function notAMigrationCopy(): Prisma.Sql {
  return Prisma.sql`
    NOT EXISTS (SELECT 1 FROM "BeverageSale" b WHERE b.id = s.id)
    AND NOT EXISTS (SELECT 1 FROM "BakerySale" k WHERE k.id = s.id)
    AND NOT EXISTS (SELECT 1 FROM "MilkSale" m WHERE m.id = s.id)
  `;
}

// ---------------------------------------------------------------------------
// Listing (S4)
// ---------------------------------------------------------------------------

/**
 * The unified list `select` — `SALE_LIST_SELECT` plus each line's `moduleKey`.
 *
 * ⚠️ The extra `items` is a JOIN, not a second query. That is the whole reason a
 * list row can say "beverages · milk" for FREE: at ~1.1s per round trip
 * (CLAUDE.md), fetching the modules separately would cost a real second of the
 * owner's time for a fact already on the rows being read.
 *
 * `_count` rides along from `SALE_LIST_SELECT` and still supplies `itemCount`;
 * the joined `items` carry ONLY `moduleKey`, never money — a list row's total is
 * the stored `totalAmount` and is never re-added from lines.
 */
export const UNIFIED_SALE_LIST_SELECT = {
  ...SALE_LIST_SELECT,
  items: { select: { moduleKey: true } },
} as const;

/** A raw row from {@link UNIFIED_SALE_LIST_SELECT}. */
export type UnifiedSaleListRowRaw = {
  id: string;
  saleDate: Date;
  totalAmount: Prisma.Decimal;
  notes: string | null;
  createdAt: Date;
  customer: { id: string; name: string; type: string };
  _count: { items: number };
  items: { moduleKey: string }[];
};

/** Module display order — the declaration order in `MODULE_CATEGORIES`. */
const MODULE_ORDER = Object.keys(MODULE_CATEGORIES) as ModuleKey[];

/**
 * Shape a unified list row: `_count` flattened to `itemCount` (via the shared
 * `toSaleListRow`, not a second implementation) and the line modules deduped
 * into a stable, ordered `modules` array.
 *
 * ORDER IS FIXED by `MODULE_CATEGORIES`, never by the order the lines happen to
 * be in — otherwise the same bill would label itself "bakery · beverages" or
 * "beverages · bakery" depending on which product the owner tapped first, and a
 * list that reshuffles its own labels reads as two different sales.
 *
 * An UNRECOGNISED `moduleKey` is kept (sorted, after the known ones) rather than
 * dropped. `moduleKey` is a snapshot on a stored row, so a value this build does
 * not know about is history to be shown, not noise to be hidden.
 */
export function toUnifiedSaleListRow(row: UnifiedSaleListRowRaw) {
  const { items, ...rest } = row;

  const present = new Set(items.map((item) => item.moduleKey));
  const known = MODULE_ORDER.filter((key) => present.has(key));
  const unknown = Array.from(present)
    .filter((key) => !MODULE_ORDER.includes(key as ModuleKey))
    .sort();

  return { ...toSaleListRow(rest), modules: [...known, ...unknown] };
}
