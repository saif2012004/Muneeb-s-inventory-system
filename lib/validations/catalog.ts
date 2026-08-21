import { z } from "zod";

/**
 * Catalog validation, shared by the API routes and the catalog forms so both
 * sides agree on what is acceptable. Zod only — no Prisma import, so this is
 * safe to pull into a client component.
 *
 * The string unions mirror the comments on the Product model in
 * schema.prisma. They are stored as plain strings (not Postgres enums), so
 * these schemas are the only thing keeping the values honest.
 */

const name = z
  .string()
  .trim()
  .min(1, { message: "Name is required" })
  .max(60, { message: "Name must be 60 characters or fewer" });

/** Decimal(10, 2) tops out at 99,999,999.99. */
const price = z
  .number({ message: "Price must be a number" })
  .min(0, { message: "Price cannot be negative" })
  .max(99_999_999.99, { message: "Price is too large" });

/**
 * Units on hand, in the product's BASE UNIT. Non-negative, at most 2 decimals.
 *
 * ---------------------------------------------------------------------------
 * 🔴 IT WAS `.int()` UNTIL 2026-08-21, AND THAT WAS WRONG FOR WEIGHT AND VOLUME
 * ---------------------------------------------------------------------------
 * The old rule read "you cannot have 2.5 bottles on a shelf" — true of a
 * bottle, and false of the two base units this catalog actually holds that are
 * measured rather than counted:
 *
 *   litre   `prod_milk` — the delivery bridge writes fractional litres all day
 *   kg      the biscuits, added 2026-08-21
 *
 * So the editor could not SET a stock figure that the sale path was perfectly
 * happy to WRITE. `Product.stock` has been `Decimal(10,2)` since Migration D
 * (2026-08-12) precisely so it could hold these; this validator was the last
 * thing still insisting otherwise, and it was the documented escape hatch for
 * correcting milk stock — which could not express 4,050.5 L.
 *
 * Two decimals, matching the column, so what validates is what gets stored.
 * Negative is still refused: it is the exact state the sale block exists to
 * prevent, so it must not be reachable through the editor either.
 */
const stock = z
  .number({ message: "Stock must be a number" })
  .min(0, { message: "Stock cannot be negative" })
  .max(1_000_000, { message: "Stock is too large" })
  .multipleOf(0.01, { message: "Stock can have at most 2 decimals" });

const id = z.string().min(1, { message: "A valid id is required" });

/**
 * Ascending, because this list IS the order of the Size dropdown.
 *
 * The four sub-litre sizes and 2L arrived with the owner's bottles-per-pet
 * matrix (2026-08-17, CHECKLIST #19). They are not cosmetic: this is a zod
 * enum, so a size the catalog holds but this list does not KNOW cannot be saved
 * — editing "7Up 250ml" to fix a typo would have been rejected, or silently
 * blanked its size, on a product the seed had just created.
 *
 * "half_litre" (labelled "0.5L") is kept as the spelling for 500ml rather than
 * adding a second "500ml" beside it, so the same bottle cannot appear in the
 * catalog under two names.
 */
export const PRODUCT_SIZES = [
  "200ml",
  "250ml",
  "300ml",
  "350ml",
  "half_litre",
  "1L",
  "1.5L",
  "2L",
  "2.25L",
  "large",
  "small",
] as const;

// NO product discount. A discount is a sale-time percentage snapshotted on
// SaleItem.discountPercent, never an attribute of the product — see the
// Discounts rule in CLAUDE.md. Re-adding one here would let the catalog
// recreate the variant products the rework deleted.
export const QUALITY_TIERS = ["premium", "simple"] as const;
export const PRODUCT_SHAPES = ["circle", "rectangular_round"] as const;
/**
 * THE BASE UNIT — what `stock` is counted in, and what every selling unit's
 * `baseFactor` multiplies (Migration F).
 *
 * "egg" and "litre" are here because two products in the catalog already use
 * them and this enum is what the editor validates against. `prod_milk` has been
 * "litre" since 2026-08-13 and was NOT in this list — so opening the milk
 * product in the edit dialog offered no matching option, and saving would have
 * dropped its unit. `prod_eggs` became "egg" on 2026-08-18 when the owner
 * defined the egg pool in single eggs.
 *
 * "cotton" stays: it is what `prod_eggs` used to be, and removing a value from
 * this enum is what breaks editing a row that still holds it.
 */
export const PRODUCT_UNITS = [
  "cotton",
  "egg",
  "piece",
  "bottle",
  "litre",
  // WEIGHT (2026-08-21). The biscuits are sold loose off a scale, so the pool
  // is kilograms and a 200 g sale is the ordinary decimal quantity 0.2 — the
  // same shape milk has used since 2026-08-13. Nothing else about a weighed
  // product is special: one stock pool, one base unit, `quantity × unitFactor`.
  "kg",
] as const;

/** Display labels. "half_litre" is stored; "0.5L" is what the owner reads. */
export const SIZE_LABELS: Record<(typeof PRODUCT_SIZES)[number], string> = {
  "200ml": "200ml",
  "250ml": "250ml",
  "300ml": "300ml",
  "350ml": "350ml",
  half_litre: "0.5L",
  "2L": "2L",
  "1L": "1L",
  "1.5L": "1.5L",
  "2.25L": "2.25L",
  large: "Large",
  small: "Small",
};

// `.nullable().optional()` throughout: omitted means "leave unchanged" on a
// PATCH, while an explicit null means "clear this attribute".
const size = z.enum(PRODUCT_SIZES).nullable().optional();
const qualityTier = z.enum(QUALITY_TIERS).nullable().optional();
const shape = z.enum(PRODUCT_SHAPES).nullable().optional();
const unit = z.enum(PRODUCT_UNITS).nullable().optional();

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export const categoryCreateSchema = z.object({ name });
export const categoryUpdateSchema = z.object({ name });

// ---------------------------------------------------------------------------
// SubCategory
// ---------------------------------------------------------------------------

export const subCategoryCreateSchema = z.object({
  name,
  categoryId: id,
});

/** Rename, and/or move to a different category. */
export const subCategoryUpdateSchema = z
  .object({ name: name.optional(), categoryId: id.optional() })
  .refine((value) => value.name !== undefined || value.categoryId !== undefined, {
    message: "Nothing to update",
  });

/**
 * The per-unit COOLING CHARGE (Migration E), set by the owner in the catalog.
 *
 * NULLABLE, and the null is meaningful: null = this product is never chilled,
 * so the till shows no toggle for it. `0` would mean "chilled, at no charge"
 * and WOULD show one. Clearing the field sends null, not 0.
 *
 * Same 2dp money bounds as `price` — it is money on a bill.
 */
const coolingCharge = z
  .number({ message: "Cooling charge must be a number" })
  .min(0, { message: "Cooling charge cannot be negative" })
  .max(99_999_999.99, { message: "Cooling charge is too large" })
  .nullable()
  .optional();

/**
 * A SELLING UNIT on a product (S8) — "dozen" 12 @ 200, "pet 6" 6 @ 560.
 *
 * `baseFactor` must be > 0: a unit worth zero base units would sell goods
 * without touching stock, which is the one failure this feature exists to
 * prevent. Two decimals, matching the column.
 */
const productUnit = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Unit name is required" })
    .max(40, { message: "Unit name must be 40 characters or fewer" }),
  baseFactor: z
    .number({ message: "Units per pack must be a number" })
    .positive({ message: "Units per pack must be greater than zero" })
    .max(1_000_000, { message: "Units per pack is too large" })
    .multipleOf(0.01, { message: "Units per pack can have at most 2 decimals" }),
  price: z
    .number({ message: "Unit price must be a number" })
    .min(0, { message: "Unit price cannot be negative" })
    .max(99_999_999.99, { message: "Unit price is too large" }),
  isDefault: z.boolean().optional(),
});

/**
 * The COMPLETE desired set of units, replace-all — the same contract as a sale's
 * `items`. Omit the field entirely to leave the existing units untouched; send
 * `[]` to remove them all and go back to selling in base units.
 *
 * Duplicated names are rejected here rather than at the database's unique index,
 * so the owner gets a sentence instead of a constraint violation.
 */
const productUnits = z
  .array(productUnit)
  .max(10, { message: "A product can have at most 10 selling units" })
  .refine(
    (units) => new Set(units.map((u) => u.name.toLowerCase())).size === units.length,
    { message: "Two selling units have the same name" }
  )
  .refine((units) => units.filter((u) => u.isDefault).length <= 1, {
    message: "Only one selling unit can be the default",
  })
  .optional();

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export const productCreateSchema = z.object({
  name,
  subCategoryId: id,
  price,
  coolingCharge,
  units: productUnits,
  size,
  qualityTier,
  shape,
  unit,
  isActive: z.boolean().optional(),
});

/**
 * Every field optional so the inline price editor can PATCH `{ price }` alone
 * without resending the whole product.
 */
export const productUpdateSchema = z
  .object({
    name: name.optional(),
    subCategoryId: id.optional(),
    price: price.optional(),
    coolingCharge,
    units: productUnits,
    stock: stock.optional(),
    size,
    qualityTier,
    shape,
    unit,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type SubCategoryCreateInput = z.infer<typeof subCategoryCreateSchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
