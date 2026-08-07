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
  // 0 and null both mean "no discount" — neither should read as "0% off".
  // Every seeded BAKERY product stores 0 here, so this must stay falsy-checked.
  if (product.discountPercent) parts.push(`${product.discountPercent}% off`);

  return parts;
}

export function toSaleProductOption(product: Product): SaleProductOption {
  const brand = product.subCategory.name;
  const parts = detailParts(product);

  return {
    product,
    brand,
    label: [brand, ...parts].join(SEPARATOR),
    detail: parts.join(SEPARATOR),
    needsPrice: product.price === 0,
  };
}

/**
 * Group into brands for the picker.
 *
 * Within a brand: size first, then the remaining attributes, then discount
 * ascending — so the full-price row sits above its discount variants. Listing
 * "60% off" above the plain product would bury the common case.
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
        const shape = (a.product.shape ?? "").localeCompare(b.product.shape ?? "");
        if (shape !== 0) return shape;
        return (a.product.discountPercent ?? 0) - (b.product.discountPercent ?? 0);
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
