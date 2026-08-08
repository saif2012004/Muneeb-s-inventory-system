/**
 * Shared money + line-item mechanics for the sale modules.
 *
 * Beverages (Phase 3) uses this now; Bakery (Phase 4) is the same shape and
 * will use it unchanged. Keeping the arithmetic here is what stops the two
 * modules drifting on the one rule that must never drift — the price snapshot.
 *
 * ---------------------------------------------------------------------------
 * PRICE SNAPSHOT (Gotcha 5, non-negotiable)
 * ---------------------------------------------------------------------------
 * A sale line stores its OWN `unitPrice`, copied from `Product.price` at the
 * moment the line is written. Every total is computed from that snapshot.
 * Nothing here ever re-joins to `Product.price` to value a historical line, so
 * editing a price in the catalog cannot move a number on a past sale.
 *
 * ---------------------------------------------------------------------------
 * ALL MONEY MATHS IS Decimal, SERVER-SIDE
 * ---------------------------------------------------------------------------
 * `Prisma.Decimal` throughout — never JS floats, which would turn
 * 3 x 33.33 into 99.99000000000001. Serialization to `number` happens once, at
 * the route boundary, via lib/serialize.ts (Gotcha 2).
 */
import { Prisma } from "@prisma/client";

import { endOfKarachiDay, startOfKarachiDay } from "@/lib/format";

/** Decimal(10, 2) tops out here. A total above it would throw inside Prisma. */
export const MAX_MONEY = new Prisma.Decimal("99999999.99");

/** What the sale routes need to know about a product to build a line from it. */
export type SaleProduct = {
  id: string;
  name: string;
  price: Prisma.Decimal;
  isActive: boolean;
  subCategory: { categoryId: string };
};

/** The Prisma `select` that produces a {@link SaleProduct}. */
export const SALE_PRODUCT_SELECT = {
  id: true,
  name: true,
  price: true,
  isActive: true,
  subCategory: { select: { categoryId: true } },
} as const;

/**
 * The full sale shape returned by create, read-one and update, so those three
 * never drift. Written generically (customer / items / product are the same
 * relation names on BakerySale) so Phase 4 can reuse it as-is.
 *
 * `product` is joined for its NAME ONLY. The money on a line is `unitPrice` and
 * `lineTotal`, both stored on the line itself — never `product.price`
 * (Gotcha 5). `product.isActive` rides along so the UI can flag a line whose
 * product has since been deactivated.
 */
export const SALE_DETAIL_SELECT = {
  id: true,
  saleDate: true,
  // The whole-bill discount ACTUALLY APPLIED, read from the sale, never
  // recomputed. An old bill must show what was charged even after the catalog
  // price and the owner's usual discount have both moved on.
  discountPercent: true,
  totalAmount: true,
  notes: true,
  createdAt: true,
  customer: { select: { id: true, name: true, phone: true, type: true } },
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      // Same for the line: the snapshot, not today's value.
      discountPercent: true,
      lineTotal: true,
      product: {
        select: {
          id: true,
          name: true,
          size: true,
          // qualityTier and shape are what separate Biscuits Premium from
          // Simple, and all four Russ variants from each other. Without them an
          // expanded bakery line can't say which product it actually was.
          qualityTier: true,
          shape: true,
          discountPercent: true,
          // Eggs sell by the cotton; the unit is what makes "3" mean something.
          unit: true,
          isActive: true,
        },
      },
    },
    // cuid is time-prefixed, so id order is insertion order — a stable line
    // order without adding a position column to the schema.
    orderBy: { id: "asc" },
  },
} as const;

/** A computed line, ready to write. `unitPrice` is already snapshotted. */
export type SaleLine = {
  productId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  /** The discount actually applied to this line, snapshotted with the price. */
  discountPercent: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

/**
 * A rejection carrying the message to show the owner and the status to send.
 * Returned rather than thrown so callers stay a straight line of `if` checks.
 */
export type SaleProblem = { message: string; status: number };

export function isSaleProblem(value: unknown): value is SaleProblem {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    "status" in value
  );
}

/**
 * Load every product referenced by a sale and verify all of them are sellable
 * in this module.
 *
 * Three ways this fails, each with its own message, because "invalid product"
 * tells the owner nothing about what to do next:
 *   - the id does not exist          -> 404, the catalog row was deleted
 *   - it belongs to another module   -> 400, a bakery item on a beverage sale
 *   - it is deactivated              -> 400, no longer sold
 *
 * Checking here is also what keeps a raw foreign-key error (P2003) from ever
 * reaching the owner: by the time we write, every id is known to exist.
 */
export async function loadSaleProducts(
  productIds: string[],
  options: {
    categoryId: string;
    moduleLabel: string;
    findMany: (ids: string[]) => Promise<SaleProduct[]>;
  }
): Promise<Map<string, SaleProduct> | SaleProblem> {
  const unique = Array.from(new Set(productIds));
  const products = await options.findMany(unique);
  const byId = new Map(products.map((product) => [product.id, product]));

  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return {
      message:
        missing.length === 1
          ? "One of the products on this sale no longer exists. Remove that line and try again."
          : `${missing.length} of the products on this sale no longer exist. Remove those lines and try again.`,
      status: 404,
    };
  }

  const foreign = products.filter(
    (product) => product.subCategory.categoryId !== options.categoryId
  );
  if (foreign.length > 0) {
    return {
      message: `"${foreign[0].name}" is not a ${options.moduleLabel} product, so it can't go on a ${options.moduleLabel.toLowerCase()} sale.`,
      status: 400,
    };
  }

  const inactive = products.filter((product) => !product.isActive);
  if (inactive.length > 0) {
    return {
      message: `"${inactive[0].name}" is deactivated and can't be added to a new sale. Reactivate it in the catalog first.`,
      status: 400,
    };
  }

  return byId;
}

/**
 * Snapshot a price for a line.
 *
 * An explicit `unitPrice` from the client always wins. That is the point of the
 * override: the seed ships all 62 products at price 0, so the owner must be
 * able to sell at a real price before they have gone through and set every
 * catalog price. Absent an override, the current catalog price is copied.
 */
export function snapshotUnitPrice(
  product: SaleProduct,
  override: number | undefined
): Prisma.Decimal {
  return override === undefined ? product.price : new Prisma.Decimal(override);
}

// ---------------------------------------------------------------------------
// Discount
// ---------------------------------------------------------------------------

/**
 * THE STACKING ORDER. One place, so the two modules and the UI preview cannot
 * disagree about what a bill comes to.
 *
 *   lineTotal = round(qty x unitPrice x (1 - lineDiscount/100), 2)
 *   subtotal  = SUM(lineTotal)
 *   total     = round(subtotal x (1 - saleDiscount/100), 2)
 *
 * Rounded to 2dp at BOTH points — after each line, and again after the bill
 * discount — never by letting a full-precision value drift to the end. Each
 * lineTotal is a rupee figure the owner can see on the bill, so it has to be a
 * real 2dp number, and the subtotal must be the sum of the numbers shown rather
 * than a more precise quantity that happens to print the same.
 *
 * Order matters and is NOT commutative once rounding is involved: line-then-bill
 * and bill-then-line can differ by a paisa. Line first, always.
 */

/** Money is 2dp. Prisma.Decimal rounds ROUND_HALF_UP by default — verified. */
export const MONEY_DP = 2;

export function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_DP);
}

/**
 * `1 - percent/100` as an exact Decimal.
 *
 * Kept as a multiplier rather than "compute the discount then subtract it"
 * because the subtract form drifts: `333 * 0.07` is `23.310000000000002` in
 * IEEE floats. On Decimal both forms are exact, but the multiplier form is one
 * operation and one rounding point instead of two.
 */
function discountMultiplier(discountPercent: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(1).minus(discountPercent.div(100));
}

/**
 * `round(quantity x unitPrice x (1 - discount/100), 2)`.
 *
 * Why Decimal and not floats, concretely: 3 x Rs. 12.50 at 33% off is exactly
 * 25.125, which rounds HALF-UP to **25.13**. In floats the same expression is
 * 25.124999999999996, which rounds to **25.12** — the owner is short a paisa and
 * the bill does not foot. That case is in the browser verification.
 */
export function computeLineTotal(
  unitPrice: Prisma.Decimal,
  quantity: number,
  discountPercent: Prisma.Decimal = new Prisma.Decimal(0)
): Prisma.Decimal {
  return roundMoney(
    unitPrice.mul(quantity).mul(discountMultiplier(discountPercent))
  );
}

/**
 * The whole-bill discount, applied to the subtotal of already-discounted lines.
 * Second and last rounding point.
 */
export function applySaleDiscount(
  subtotal: Prisma.Decimal,
  discountPercent: Prisma.Decimal
): Prisma.Decimal {
  return roundMoney(subtotal.mul(discountMultiplier(discountPercent)));
}

/** Sum of every line total. The sale's `totalAmount` is never client-supplied. */
export function sumLineTotals(lines: { lineTotal: Prisma.Decimal }[]): Prisma.Decimal {
  return lines.reduce(
    (total, line) => total.add(line.lineTotal),
    new Prisma.Decimal(0)
  );
}

/**
 * Subtotal -> total in one call, so no route re-derives the second half of the
 * stacking order by hand.
 */
export function computeSaleTotal(
  lines: { lineTotal: Prisma.Decimal }[],
  saleDiscountPercent: Prisma.Decimal
): { subtotal: Prisma.Decimal; total: Prisma.Decimal } {
  const subtotal = sumLineTotals(lines);
  return { subtotal, total: applySaleDiscount(subtotal, saleDiscountPercent) };
}

/**
 * Guard the column bound before writing. Without this the owner gets a generic
 * 500 from a numeric overflow deep inside Prisma; with it they get told the
 * total is too large, which is something they can act on.
 */
export function checkTotalFits(total: Prisma.Decimal): SaleProblem | null {
  if (total.greaterThan(MAX_MONEY)) {
    return {
      message: "That sale total is too large to record. Split it across two sales.",
      status: 400,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/** The list `select`, shared by every module. No line items — just the count. */
export const SALE_LIST_SELECT = {
  id: true,
  saleDate: true,
  totalAmount: true,
  notes: true,
  createdAt: true,
  customer: { select: { id: true, name: true, type: true } },
  _count: { select: { items: true } },
} as const;

/** Newest first, with a stable tiebreak so paging can't repeat or skip a row. */
export const SALE_LIST_ORDER = [
  { saleDate: "desc" },
  { createdAt: "desc" },
] as const;

/**
 * Turn validated list filters into the `saleDate` window, in Asia/Karachi.
 *
 * `dateTo` becomes the UTC instant of the START of the FOLLOWING Karachi day and
 * is compared with `lt`, so the named day is fully included without `lte`
 * double-counting a sale landing exactly on midnight (Gotcha 4).
 *
 * Returns a SaleProblem for a backwards range rather than throwing, so the
 * caller answers with a sentence instead of a 500.
 */
export function buildSaleDateWindow(
  dateFrom: string | undefined,
  dateTo: string | undefined
): { gte?: Date; lt?: Date } | SaleProblem | null {
  const start = dateFrom ? startOfKarachiDay(dateFrom) : undefined;
  const end = dateTo ? endOfKarachiDay(dateTo) : undefined;

  if (start && end && start >= end) {
    return {
      message: "The start date must be on or before the end date.",
      status: 400,
    };
  }
  if (!start && !end) return null;

  return { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) };
}

/** Shape a list row for the client: Decimals serialized, count flattened. */
export function toSaleListRow<
  T extends { _count: { items: number } },
>(row: T): Omit<T, "_count"> & { itemCount: number } {
  const { _count, ...rest } = row;
  return { ...rest, itemCount: _count.items };
}

// ---------------------------------------------------------------------------
// Editing an existing sale
// ---------------------------------------------------------------------------

/** A line as it is stored today. */
export type ExistingSaleLine = {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
};

/** A line as the client submitted it. `id` absent = a new line. */
export type SubmittedSaleLine = {
  id?: string;
  productId: string;
  quantity: number;
  unitPrice?: number;
  discountPercent?: number;
};

export type LineReconciliation = {
  updates: (SaleLine & { id: string })[];
  creates: SaleLine[];
  removedIds: string[];
  /** Lines whose stored price was replaced by a fresh catalog snapshot. */
  repricedItemIds: string[];
};

/**
 * Diff the submitted lines against the stored ones and decide, per line, which
 * price applies. Pure — no database access — so the snapshot rule can be
 * verified directly rather than inferred from an HTTP response.
 *
 * The submitted array is the COMPLETE desired set of lines:
 *   entry WITH `id`    -> that stored line, kept or edited
 *   entry WITHOUT `id` -> a new line
 *   stored line absent -> removed from the sale
 *
 * ---------------------------------------------------------------------------
 * WHEN A PRICE IS RE-SNAPSHOTTED (see "Price snapshot" in CLAUDE.md)
 * ---------------------------------------------------------------------------
 *   new line              -> fresh snapshot of the current catalog price
 *   PRODUCT changed       -> fresh snapshot (it is a different item now, so the
 *                            old item's price is meaningless for it)
 *   QUANTITY changed only -> KEEPS its original snapshot
 *   explicit unitPrice    -> that value wins over everything above
 *
 * Quantity is deliberately NOT a re-price trigger. Correcting "12 crates" to
 * "15 crates" on a months-old sale is a typo fix, not a re-sale; re-pricing it
 * at today's catalog price would silently move a historical total the owner was
 * not asking to change. Only a genuinely different product justifies a new
 * price, because the stored snapshot belongs to the product it was taken from.
 */
export function reconcileSaleLines(
  existing: ExistingSaleLine[],
  submitted: SubmittedSaleLine[],
  products: Map<string, SaleProduct>
): LineReconciliation | SaleProblem {
  const submittedIds = submitted
    .map((line) => line.id)
    .filter((id): id is string => id !== undefined);

  if (new Set(submittedIds).size !== submittedIds.length) {
    return { message: "The same sale line was submitted twice.", status: 400 };
  }

  const currentById = new Map(existing.map((line) => [line.id, line]));
  if (submittedIds.some((id) => !currentById.has(id))) {
    return {
      message:
        "One of the lines you edited is no longer part of this sale. Reload and try again.",
      status: 409,
    };
  }

  const updates: (SaleLine & { id: string })[] = [];
  const creates: SaleLine[] = [];
  const repricedItemIds: string[] = [];

  for (const line of submitted) {
    // Non-null: the caller proves every product id resolves before we run.
    const product = products.get(line.productId)!;
    const prior = line.id ? currentById.get(line.id) : undefined;

    if (!prior) {
      const unitPrice = snapshotUnitPrice(product, line.unitPrice);
      const discountPercent = new Prisma.Decimal(line.discountPercent ?? 0);
      creates.push({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice,
        discountPercent,
        lineTotal: computeLineTotal(unitPrice, line.quantity, discountPercent),
      });
      continue;
    }

    // NOTE: quantity is absent from this predicate on purpose — see the block
    // comment above. Changing it here silently re-prices historical sales.
    const productChanged = prior.productId !== line.productId;

    const unitPrice =
      line.unitPrice !== undefined
        ? new Prisma.Decimal(line.unitPrice)
        : productChanged
          ? product.price
          : prior.unitPrice;

    if (
      productChanged &&
      line.unitPrice === undefined &&
      !prior.unitPrice.equals(unitPrice)
    ) {
      repricedItemIds.push(prior.id);
    }

    /**
     * The discount is a SALE-TIME decision, not a property of the product, so
     * unlike the price it never re-snapshots on its own: swapping the product on
     * a line does not change the deal the owner struck. Send a value to change
     * it, omit it to keep what was stored.
     */
    const discountPercent =
      line.discountPercent !== undefined
        ? new Prisma.Decimal(line.discountPercent)
        : prior.discountPercent;

    updates.push({
      id: prior.id,
      productId: line.productId,
      quantity: line.quantity,
      unitPrice,
      discountPercent,
      lineTotal: computeLineTotal(unitPrice, line.quantity, discountPercent),
    });
  }

  const kept = new Set(submittedIds);
  const removedIds = existing
    .map((line) => line.id)
    .filter((id) => !kept.has(id));

  return { updates, creates, removedIds, repricedItemIds };
}
