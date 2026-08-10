/**
 * Catalog seed — Phase 2. See the "Seed Data (dev)" section in CLAUDE.md.
 *
 * Prisma 6 conventions only: `import { PrismaClient } from "@prisma/client"`,
 * no generated output path, no driver adapter, no prisma.config.ts. The seed
 * command lives in package.json under the `prisma.seed` key (v6); v7 moved it
 * into prisma.config.ts and that does NOT apply here.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCY
 * ---------------------------------------------------------------------------
 * Category.name, SubCategory.name and Product.name are NOT unique in the
 * schema, and `upsert` requires a unique field in `where`. So every seeded row
 * carries a DETERMINISTIC id ("prod_pepsi_1_5l_d20") instead of a random cuid.
 * The id is the primary key, so it is unique by definition, and a re-run maps
 * onto exactly the same rows. Rows the owner creates through the UI still get
 * a normal cuid from @default(cuid()) — the two never collide.
 *
 * Every upsert uses `update: {}`, making this seed purely ADDITIVE: it creates
 * what is missing and touches nothing that already exists. That is deliberate.
 * Once seeded, the database is the source of truth — the owner sets prices and
 * can rename or deactivate anything. A re-run must never reset a price the
 * owner entered back to 0, nor revive a product they deactivated, nor undo a
 * rename. Fixing a typo in this file therefore will NOT propagate to a row that
 * already exists; edit it in the catalog UI instead.
 *
 * Not wrapped in a transaction: 75 sequential upserts would risk blowing the
 * 5s interactive-transaction timeout, and because the seed is idempotent and
 * additive, a partial run is safely fixed by simply running it again.
 *
 * Prices are all 0 and everything is active. The owner sets real prices with
 * the inline price editor.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Shape of the seed data
// ---------------------------------------------------------------------------

type CategorySeed = { id: string; name: string };

type SubCategorySeed = { id: string; name: string; categoryId: string };

type ProductSeed = {
  id: string;
  name: string;
  subCategoryId: string;
  size: string | null;
  qualityTier: string | null;
  shape: string | null;
  unit: string | null;
};

/** "2.25L" -> "2_25l". Keeps generated ids readable and URL-safe. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * The catalog covers Beverages and Bakery ONLY. Milk is deliberately absent:
 * it is modelled in its own tables (MilkDelivery, FarmerPurchase, MilkSale) by
 * liters x rate, never as a catalog Product. Do not add a "Milk Shop" category.
 */
const CATEGORIES: CategorySeed[] = [
  { id: "cat_beverages", name: "Beverages" },
  { id: "cat_bakery", name: "Bakery" },
];

// ---------------------------------------------------------------------------
// Beverages — each brand is a SubCategory
// ---------------------------------------------------------------------------

/** `size` values match the schema comment; `label` is what the owner reads. */
const BEVERAGE_SIZES = [
  { size: "half_litre", label: "0.5L" },
  { size: "1L", label: "1L" },
  { size: "1.5L", label: "1.5L" },
  { size: "2.25L", label: "2.25L" },
] as const;

/**
 * NO DISCOUNT TIERS ANY MORE — this used to be `[0, 20, 30, 60]`, and each tier
 * became its own Product row ("Pepsi 1.5L (30% off)").
 *
 * That produced 36 variant rows for 12 physical drinks, and it made a discount
 * a property of the CATALOG rather than of the sale: the owner could only ever
 * give 20/30/60%, and the same bottle was tracked under four ids. Discount is
 * now entered on the sale — per line and per whole bill — so one product row
 * means one real thing you can sell.
 *
 * The 36 existing variant rows were deleted from the development database by a
 * one-off guarded script on 2026-08-09. This seed is the other half of that
 * change: because it uses `upsert` on deterministic ids, leaving the tier loop
 * in place would have resurrected every variant on the next re-seed.
 */

/** Brands sold in four sizes. One row per size — no variants. */
const SIZED_BRANDS = ["Pepsi", "Coke Cola", "Gourmet"] as const;

/** Juice comes in two sizes and has no discount variants. */
const JUICE_SIZES = ["half_litre", "1L"] as const;

/** Single-product brands: no sizes, no discount variants. */
const SINGLE_BRANDS = ["Big Apple", "Big Lychee"] as const;

const beverageSubCategories: SubCategorySeed[] = [
  ...SIZED_BRANDS,
  "Juice",
  ...SINGLE_BRANDS,
].map((name) => ({
  id: `sub_${slug(name)}`,
  name,
  categoryId: "cat_beverages",
}));

const beverageProducts: ProductSeed[] = [
  // Pepsi / Coke Cola / Gourmet: 4 sizes each = 12 products.
  // The ids are unchanged from the pre-rework base rows (`prod_pepsi_1_5l`),
  // so a re-seed still matches the products already in the database and the
  // owner's prices survive.
  ...SIZED_BRANDS.flatMap((brand) =>
    BEVERAGE_SIZES.map(({ size, label }) => ({
      id: `prod_${slug(brand)}_${slug(size)}`,
      name: `${brand} ${label}`,
      subCategoryId: `sub_${slug(brand)}`,
      size,
      qualityTier: null,
      shape: null,
      unit: "bottle",
    }))
  ),

  // Juice: 2 sizes, full price only.
  ...JUICE_SIZES.map((size) => {
    const label = BEVERAGE_SIZES.find((s) => s.size === size)!.label;
    return {
      id: `prod_juice_${slug(size)}`,
      name: `Juice ${label}`,
      subCategoryId: "sub_juice",
      size,
      qualityTier: null,
      shape: null,
      unit: "bottle",
    };
  }),

  // Big Apple / Big Lychee: one product each.
  ...SINGLE_BRANDS.map((brand) => ({
    id: `prod_${slug(brand)}`,
    name: brand,
    subCategoryId: `sub_${slug(brand)}`,
    size: null,
    qualityTier: null,
    shape: null,
    unit: "bottle",
  })),
];

// ---------------------------------------------------------------------------
// Bakery
// ---------------------------------------------------------------------------

const bakerySubCategories: SubCategorySeed[] = [
  "Cake Rusk",
  "Buns",
  "Biscuits",
  "Russ",
  "Eggs",
].map((name) => ({
  id: `sub_${slug(name)}`,
  name,
  categoryId: "cat_bakery",
}));

/** Russ = 2 sizes x 2 shapes = 4 products. */
const RUSS_SIZES = ["large", "small"] as const;
const RUSS_SHAPES = [
  { shape: "circle", label: "Circle" },
  { shape: "rectangular_round", label: "Rectangular Round" },
] as const;

const bakeryProducts: ProductSeed[] = [
  // Quality-tier pairs.
  ...(
    [
      { base: "Cake Rusk", subCategoryId: "sub_cake_rusk" },
      { base: "Biscuits", subCategoryId: "sub_biscuits" },
    ] as const
  ).flatMap(({ base, subCategoryId }) =>
    (["premium", "simple"] as const).map((qualityTier) => ({
      id: `prod_${slug(base)}_${qualityTier}`,
      name: `${base} ${qualityTier === "premium" ? "Premium" : "Simple"}`,
      subCategoryId,
      size: null,
      qualityTier,
      shape: null,
      unit: "piece",
    }))
  ),

  {
    id: "prod_buns",
    name: "Buns",
    subCategoryId: "sub_buns",
    size: null,
    qualityTier: null,
    shape: null,
    unit: "piece",
  },

  ...RUSS_SIZES.flatMap((size) =>
    RUSS_SHAPES.map(({ shape, label }) => ({
      id: `prod_russ_${size}_${slug(shape)}`,
      name: `Russ ${size === "large" ? "Large" : "Small"} ${label}`,
      subCategoryId: "sub_russ",
      size,
      qualityTier: null,
      shape,
      unit: "piece",
    }))
  ),

  // Sold by the cotton: quantity on a sale line = number of cottons.
  {
    id: "prod_eggs",
    name: "Eggs",
    subCategoryId: "sub_eggs",
    size: null,
    qualityTier: null,
    shape: null,
    unit: "cotton",
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// Exported so the data can be inspected/counted without opening a connection.
export const SUB_CATEGORIES = [
  ...beverageSubCategories,
  ...bakerySubCategories,
];
export const PRODUCTS = [...beverageProducts, ...bakeryProducts];
export { CATEGORIES };

async function main() {
  // Order matters: a SubCategory needs its Category, a Product its SubCategory.
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { id: category.id },
      update: {},
      create: category,
    });
  }

  for (const subCategory of SUB_CATEGORIES) {
    await prisma.subCategory.upsert({
      where: { id: subCategory.id },
      update: {},
      create: subCategory,
    });
  }

  for (const product of PRODUCTS) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: {},
      create: { ...product, price: 0, isActive: true },
    });
  }

  console.log(
    `Seed complete: ${CATEGORIES.length} categories, ` +
      `${SUB_CATEGORIES.length} sub-categories, ${PRODUCTS.length} products.`
  );
}

// Only opens a connection when this file is the entry point (`prisma db seed`
// runs `tsx prisma/seed.ts`). Importing it elsewhere just yields the data.
if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
