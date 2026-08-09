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
 * Units on hand. A WHOLE, NON-NEGATIVE count — you cannot have 2.5 bottles on a
 * shelf, and negative stock is the exact state the sale block exists to prevent,
 * so it must not be reachable through the editor either.
 */
const stock = z
  .number({ message: "Stock must be a number" })
  .int({ message: "Stock must be a whole number" })
  .min(0, { message: "Stock cannot be negative" })
  .max(1_000_000, { message: "Stock is too large" });

const id = z.string().min(1, { message: "A valid id is required" });

export const PRODUCT_SIZES = [
  "half_litre",
  "1L",
  "1.5L",
  "2.25L",
  "large",
  "small",
] as const;

export const DISCOUNT_PERCENTS = [0, 20, 30, 60] as const;
export const QUALITY_TIERS = ["premium", "simple"] as const;
export const PRODUCT_SHAPES = ["circle", "rectangular_round"] as const;
export const PRODUCT_UNITS = ["cotton", "piece", "bottle"] as const;

/** Display labels. "half_litre" is stored; "0.5L" is what the owner reads. */
export const SIZE_LABELS: Record<(typeof PRODUCT_SIZES)[number], string> = {
  half_litre: "0.5L",
  "1L": "1L",
  "1.5L": "1.5L",
  "2.25L": "2.25L",
  large: "Large",
  small: "Small",
};

// `.nullable().optional()` throughout: omitted means "leave unchanged" on a
// PATCH, while an explicit null means "clear this attribute".
const size = z.enum(PRODUCT_SIZES).nullable().optional();
const discountPercent = z
  .union(DISCOUNT_PERCENTS.map((value) => z.literal(value)) as [
    z.ZodLiteral<0>,
    z.ZodLiteral<20>,
    z.ZodLiteral<30>,
    z.ZodLiteral<60>,
  ])
  .nullable()
  .optional();
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

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export const productCreateSchema = z.object({
  name,
  subCategoryId: id,
  price,
  size,
  discountPercent,
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
    stock: stock.optional(),
    size,
    discountPercent,
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
