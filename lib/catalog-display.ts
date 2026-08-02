/**
 * Display helpers for the catalog UI. Stored values stay machine-readable
 * ("half_litre", "rectangular_round"); these turn them into what the owner
 * reads ("0.5L", "Rectangular Round").
 */
import { formatPKR } from "@/lib/format";
import type { AccentKey } from "@/lib/nav";
import { SIZE_LABELS, type PRODUCT_SIZES } from "@/lib/validations/catalog";

type SizeValue = (typeof PRODUCT_SIZES)[number];

/**
 * Price as shown in the catalog table.
 *
 * formatPKR rounds to whole rupees by default, which is right for dashboard
 * totals but wrong here: a price stored as 312.50 would render "Rs. 313", and
 * in an editor the number IS the thing being edited — the owner would think
 * they had saved 313. Show paise only when the value actually has them, so
 * whole-rupee prices stay clean.
 */
export function formatCatalogPrice(value: number): string {
  return formatPKR(value, { precise: !Number.isInteger(value) });
}

/**
 * Design System: Beverages = blue, Bakery = amber. Milk is NOT a catalog
 * category — it is modelled by liters x rate in its own tables.
 *
 * Matched on name because the owner can create categories, which have no
 * fixed id. Anything unrecognised falls back to neutral zinc rather than
 * borrowing a module's colour.
 */
export function categoryAccent(name: string): AccentKey {
  const normalized = name.trim().toLowerCase();
  if (normalized === "beverages") return "blue";
  if (normalized === "bakery") return "amber";
  return "zinc";
}

/** "half_litre" -> "0.5L". Unknown values pass through unchanged. */
export function formatSize(size: string | null): string {
  if (!size) return "—";
  return SIZE_LABELS[size as SizeValue] ?? size;
}

/** "rectangular_round" -> "Rectangular Round"; "premium" -> "Premium". */
export function titleCase(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The Quality/Shape column carries whichever attribute a product uses:
 * bakery tiers (Premium/Simple) or russ shapes (Circle/Rectangular Round).
 */
export function formatQualityShape(product: {
  qualityTier: string | null;
  shape: string | null;
}): string {
  const parts = [product.qualityTier, product.shape]
    .filter((value): value is string => Boolean(value))
    .map(titleCase);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** 0 and null both mean "no discount" — neither should read as "0%". */
export function formatDiscount(discountPercent: number | null): string {
  if (!discountPercent) return "—";
  return `${discountPercent}%`;
}
