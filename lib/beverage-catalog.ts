/**
 * Turning the flat product list into the shape the sale form's picker needs.
 *
 * The owner does not think "product #47". They think Brand, then Size, then
 * whether it is a discount line: "Pepsi, the 1.5 litre, the 30% one". So the
 * picker groups by brand (the SubCategory) and each row reads
 * `Pepsi › 1.5L › 30% off`.
 *
 * The catalog is ~52 beverage rows, so all of this is done client-side off the
 * single `/api/products?categoryId=…` response — no request per brand.
 */
import { formatSize } from "@/lib/catalog-display";
import type { Product } from "@/lib/hooks/use-catalog";

export type BeverageOption = {
  product: Product;
  /** Brand, i.e. the SubCategory name — "Pepsi", "Juice", "Big Apple". */
  brand: string;
  /** `Pepsi › 1.5L › 30% off` — what the row shows and what search matches. */
  label: string;
  /** Everything after the brand, for the second line of a two-line row. */
  detail: string;
  /** Seeded products are all price 0 until the owner sets one. */
  needsPrice: boolean;
};

export type BeverageBrandGroup = {
  brand: string;
  options: BeverageOption[];
};

const SEPARATOR = " › ";

/**
 * The parts after the brand. A plain full-price product with no size (Big
 * Apple) has none, and must not render a dangling separator.
 */
function detailParts(product: Product): string[] {
  const parts: string[] = [];
  if (product.size) parts.push(formatSize(product.size));
  // 0 and null both mean "no discount" — neither should read as "0% off".
  if (product.discountPercent) parts.push(`${product.discountPercent}% off`);
  return parts;
}

export function toBeverageOption(product: Product): BeverageOption {
  const brand = product.subCategory.name;
  const parts = detailParts(product);
  const detail = parts.join(SEPARATOR);

  return {
    product,
    brand,
    label: [brand, ...parts].join(SEPARATOR),
    detail,
    needsPrice: product.price === 0,
  };
}

/**
 * Group into brands for the picker.
 *
 * Ordering is deliberate: brands alphabetically, then within a brand the
 * full-price line first and its discount variants after, ascending. The seeded
 * catalog has four discount tiers per size, and listing "60% off" above the
 * full-price row would make the common case the hardest to find.
 */
export function groupBeverageOptions(products: Product[]): BeverageBrandGroup[] {
  const byBrand = new Map<string, BeverageOption[]>();

  for (const product of products) {
    const option = toBeverageOption(product);
    const bucket = byBrand.get(option.brand);
    if (bucket) bucket.push(option);
    else byBrand.set(option.brand, [option]);
  }

  return Array.from(byBrand.entries())
    .map(([brand, options]) => ({
      brand,
      options: options.sort((a, b) => {
        const sizeOrder = (a.product.size ?? "").localeCompare(
          b.product.size ?? ""
        );
        if (sizeOrder !== 0) return sizeOrder;
        return (a.product.discountPercent ?? 0) - (b.product.discountPercent ?? 0);
      }),
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
}

/** Flat lookup by product id, for resolving a selected line back to its option. */
export function indexBeverageOptions(
  groups: BeverageBrandGroup[]
): Map<string, BeverageOption> {
  const index = new Map<string, BeverageOption>();
  for (const group of groups) {
    for (const option of group.options) index.set(option.product.id, option);
  }
  return index;
}
