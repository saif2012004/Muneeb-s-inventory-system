/**
 * Turning the flat product list into what a sale form's picker needs.
 *
 * Generalised from the beverages-only version in Phase 3. Beverages and Bakery
 * describe their products with DIFFERENT attributes, and the picker has to stay
 * legible for both:
 *
 *   Beverages   brand + size + discount tier   "Pepsi › 1.5L › 30% off"
 *   Bakery      quality tier                   "Biscuits › Premium"
 *               size + shape                   "Russ › Large › Circle"
 *               nothing at all                 "Buns"
 *
 * ---------------------------------------------------------------------------
 * WHY qualityTier AND shape ARE IN THE LABEL
 * ---------------------------------------------------------------------------
 * The Phase 3 version composed the label from size + discount only. That is
 * fine for beverages, but on bakery it makes products INDISTINGUISHABLE:
 *
 *   Biscuits Premium / Biscuits Simple  -> both render as just "Biscuits"
 *   Russ Large Circle / Russ Large Rect -> both render as just "Large"
 *
 * Two rows that look identical in a picker is a way to record the wrong sale.
 * So every distinguishing attribute the product actually carries goes into the
 * label, and products carrying none fall back to their brand.
 */
import { formatSize, titleCase } from "@/lib/catalog-display";
import type { Product } from "@/lib/hooks/use-catalog";

export type SaleProductOption = {
  product: Product;
  /** The SubCategory name — "Pepsi", "Russ", "Buns". */
  brand: string;
  /** Full searchable label, e.g. `Russ › Large › Circle`. */
  label: string;
  /**
   * What the picker actually SEARCHES: the label PLUS the product's own name.
   *
   * The label is composed from the sub-category and the distinguishing
   * attributes, so a product whose name is not echoed by either was
   * unreachable by typing it — the picker answered "No product found" for a
   * product sitting right there in the list. Harmless for a seeded catalog
   * where the sub-category IS the name ("Buns", "Pepsi"), and immediately wrong
   * on the unified till, where the owner types what is written on the bottle.
   *
   * Found in browser testing, 2026-08-14. Display is unchanged — this string is
   * only ever cmdk's match target, never rendered.
   */
  searchValue: string;
  /** Everything after the brand. Empty for a product with no attributes. */
  detail: string;
  /** Seeded products all start at 0 until the owner prices them. */
  needsPrice: boolean;
};

export type SaleBrandGroup = {
  brand: string;
  options: SaleProductOption[];
};

const SEPARATOR = " › ";

/**
 * The distinguishing attributes, in the order the owner says them out loud.
 * Any that the product doesn't carry are simply absent — no empty groupings,
 * no dangling separators.
 */
function detailParts(product: Product): string[] {
  const parts: string[] = [];

  if (product.size) parts.push(formatSize(product.size));
  // Bakery's Premium/Simple split, and Russ's circle vs rectangular_round.
  if (product.qualityTier) parts.push(titleCase(product.qualityTier));
  if (product.shape) parts.push(titleCase(product.shape));
  // NO discount part. A product no longer carries one — discount is chosen per
  // line on the sale form and snapshotted onto SaleItem. This used to append
  // "30% off" to distinguish the variant products the rework deleted.

  return parts;
}

export function toSaleProductOption(product: Product): SaleProductOption {
  const brand = product.subCategory.name;
  const parts = detailParts(product);

  const label = [brand, ...parts].join(SEPARATOR);

  return {
    product,
    brand,
    label,
    // The product's own name appended only when the label does not already
    // carry it, so the common case stays exactly the string it was.
    searchValue: label.toLowerCase().includes(product.name.toLowerCase())
      ? label
      : `${label} ${product.name}`,
    detail: parts.join(SEPARATOR),
    needsPrice: product.price === 0,
  };
}

/**
 * Group into brands for the picker.
 *
 * Within a brand: size, then quality tier, then shape. There is no discount
 * tiebreaker any more — the variant products it separated were deleted in the
 * discount rework, and a discount is now chosen per line on the sale form.
 */
export function groupSaleProducts(products: Product[]): SaleBrandGroup[] {
  const byBrand = new Map<string, SaleProductOption[]>();

  for (const product of products) {
    const option = toSaleProductOption(product);
    const bucket = byBrand.get(option.brand);
    if (bucket) bucket.push(option);
    else byBrand.set(option.brand, [option]);
  }

  return Array.from(byBrand.entries())
    .map(([brand, options]) => ({
      brand,
      options: options.sort((a, b) => {
        const size = (a.product.size ?? "").localeCompare(b.product.size ?? "");
        if (size !== 0) return size;
        const tier = (a.product.qualityTier ?? "").localeCompare(
          b.product.qualityTier ?? ""
        );
        if (tier !== 0) return tier;
        return (a.product.shape ?? "").localeCompare(b.product.shape ?? "");
      }),
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
}

/**
 * Grouping for the UNIFIED till, where products from all three shops sit in one
 * picker (S4.2).
 *
 * The heading becomes **`Beverages · Pepsi`** rather than bare `Pepsi`. On a
 * single-module screen the brand alone is unambiguous, because everything on
 * screen is already that module — here it is not: "Milk" as a heading gives no
 * hint whether it is the milk shop's litres or a bakery item, and two shops may
 * one day carry a similarly named brand. The category name is exactly the
 * missing word.
 *
 * `ProductPicker` needs NO change: it renders `group.brand` as the heading
 * string, so a prefixed string is simply a longer heading. cmdk still searches
 * the composed label, so typing "milk" or "pepsi" reaches the row either way.
 */
export function groupUnifiedSaleProducts(products: Product[]): SaleBrandGroup[] {
  const byGroup = new Map<string, SaleProductOption[]>();

  for (const product of products) {
    const option = toSaleProductOption(product);
    const heading = `${product.subCategory.category.name} · ${option.brand}`;
    const bucket = byGroup.get(heading);
    if (bucket) bucket.push(option);
    else byGroup.set(heading, [option]);
  }

  return Array.from(byGroup.entries())
    .map(([brand, options]) => ({
      brand,
      options: options.sort((a, b) => {
        const size = (a.product.size ?? "").localeCompare(b.product.size ?? "");
        if (size !== 0) return size;
        const tier = (a.product.qualityTier ?? "").localeCompare(
          b.product.qualityTier ?? ""
        );
        if (tier !== 0) return tier;
        return (a.product.shape ?? "").localeCompare(b.product.shape ?? "");
      }),
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
}

/** Flat lookup by product id, to resolve a selected line back to its option. */
export function indexSaleProducts(
  groups: SaleBrandGroup[]
): Map<string, SaleProductOption> {
  const index = new Map<string, SaleProductOption>();
  for (const group of groups) {
    for (const option of group.options) index.set(option.product.id, option);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Quantity units
// ---------------------------------------------------------------------------

/**
 * Units that are SELF-EVIDENT from the product, and so add nothing when named.
 *
 * Naming a unit is only worth the ink when the number would otherwise be
 * ambiguous. "12 pieces" of Buns and "12 bottles" of Pepsi tell the owner
 * nothing they didn't already know from the product name — but Eggs are sold BY
 * THE COTTON, so a bare "3" is genuinely unclear: three eggs, or three cottons?
 *
 * So the suffix is shown only for units that carry information. This is a
 * property of the UNIT, not of the module — beverages and bakery run the same
 * rule, and a future module gets the right behaviour for free.
 */
const SELF_EVIDENT_UNITS = new Set(["bottle", "piece"]);

/** True when naming this unit tells the owner something the product doesn't. */
export function unitIsInformative(unit: string | null): unit is string {
  return Boolean(unit) && !SELF_EVIDENT_UNITS.has(unit as string);
}

/** Plural form of a selling unit: `"cottons"`. Empty when there's no unit. */
export function pluralizeUnit(unit: string | null, quantity: number): string {
  if (!unit) return "";
  return quantity === 1 ? unit : `${unit}s`;
}

/**
 * `"3 cottons"` for an informative unit; a bare `"12"` for a self-evident one.
 *
 * Deliberately NOT "12 pieces" — see SELF_EVIDENT_UNITS above.
 */
export function formatQuantityWithUnit(
  quantity: number,
  unit: string | null
): string {
  if (!unitIsInformative(unit)) return String(quantity);
  return `${quantity} ${pluralizeUnit(unit, quantity)}`;
}

/** `"Quantity (cottons)"` for an informative unit, else plain `"Quantity"`. */
export function quantityFieldLabel(unit: string | null): string {
  // Always plural on the label — it names the unit, not a specific count.
  return unitIsInformative(unit) ? `Quantity (${unit}s)` : "Quantity";
}

/** `"Price per cotton"` for an informative unit, else plain `"Unit price"`. */
export function unitPriceFieldLabel(unit: string | null): string {
  return unitIsInformative(unit) ? `Price per ${unit}` : "Unit price";
}
