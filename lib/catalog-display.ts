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
 * The size / tier / shape suffix for ONE PRODUCT LINE — **with anything the
 * product's own NAME already says stripped out.**
 *
 * ---------------------------------------------------------------------------
 * 🔴 WHY THE NAME CHECK EXISTS. Do not "simplify" it away.
 * ---------------------------------------------------------------------------
 * The attributes were being appended blindly, so a receipt printed:
 *
 *     Biscuits Simple  Simple
 *     Pepsi 1L  1L
 *
 * Every product name in this catalog ALREADY carries its own attributes — the
 * seed names them that way ("Biscuits Simple", "Pepsi 1L", "Russ Large
 * Circle"). Checked against all 69 products that carry a size, tier or shape:
 * every single one duplicated. So the suffix was pure noise on a 48-character
 * roll, and worse, it read as a second product.
 *
 * The suffix is still BUILT rather than deleted, because it is genuinely useful
 * for a product whose name does not carry the attribute — a future "Russ" with
 * shape `circle` would still print `Russ · Circle`. It is the DUPLICATION that
 * is wrong, not the concept.
 *
 * ⚠️ Comparison is on letters and digits only, lowercased, so `0.5L` matches a
 * name written `0.5 L`. That means a substring match: a product named
 * "Smalltown Cola" carrying size `small` would have its "Small" suppressed.
 * Accepted deliberately — the cost is one missing disambiguator, whereas the
 * bug it fixes was on every line of every bill. No product in the catalog hits
 * it today.
 *
 * ⚠️ `formatSize` is used rather than title-casing the raw value, and that
 * matters: it maps `half_litre` → **"0.5L"**, which is what the names actually
 * say. The receipt used to title-case it into "Half Litre", which then failed
 * to match "Pepsi 0.5L" and printed anyway. Same bug, twelve products.
 */
export function composeProductDetail(product: {
  name: string;
  size: string | null;
  qualityTier: string | null;
  shape: string | null;
}): string | null {
  const size = formatSize(product.size);
  const parts = [
    size !== "—" ? size : null,
    product.qualityTier ? titleCase(product.qualityTier) : null,
    product.shape ? titleCase(product.shape) : null,
  ].filter((part): part is string => Boolean(part));

  const name = squash(product.name);
  const kept = parts.filter((part) => !name.includes(squash(part)));

  return kept.length > 0 ? kept.join(" · ") : null;
}

/** Letters and digits only, lowercased — so "0.5 L", "0.5L" and "0.5l" agree. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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

// No `formatDiscount` here. The catalog has no discount to display — a product
// does not carry one. A sale line's discount is rendered from its own
// snapshotted `discountPercent` in components/sales/SaleLineItems.tsx.
