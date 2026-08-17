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
  /**
   * Starting stock, when the schema default of 100 is WRONG for this product.
   *
   * Omit it for anything countable: 100 is a deliberate placeholder the owner
   * replaces by walking the shelf. Milk sets it to 0 — see prod_milk.
   */
  stock?: number;
  /**
   * SELLING UNITS (Migration F, CHECKLIST #19) - the packs this product is also
   * sold in, on top of the single base unit.
   *
   * STOCK IS ONE POOL, always counted in BASE units. A unit only says how many
   * base units leave that pool per pack sold, which is why `baseFactor` lives
   * on the unit and not in a second stock column: selling one peti of eggs
   * decrements the same number that selling 360 singles would.
   */
  units?: UnitSeed[];
};

/**
 * One selling unit. `price` is the price OF THE PACK, not per base unit - a
 * peti is not 360 x the single-egg price, which is the entire reason the price
 * lives here rather than being derived.
 */
type UnitSeed = {
  name: string;
  baseFactor: number;
  price: number;
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
 * The catalog covers Beverages, Bakery and — since 2026-08-13 — Milk.
 *
 * ⚠️ This block previously said "Milk is deliberately absent … never as a
 * catalog Product. Do not add a Milk Shop category." That was true until the
 * unified sale landed and is now the opposite of the design: milk IS a catalog
 * Product, so that one bill can hold beverage, bakery and milk lines together
 * and `SaleItem.moduleKey` can record which is which.
 *
 * `cat_milk` and the name "Milk Shop" must both stay exactly as written — they
 * are how `resolveLineModule` (lib/unified-sales.ts) maps a milk line to
 * `moduleKey: "milk"`, matching MODULE_CATEGORIES.milk in lib/modules.ts.
 *
 * The farmer side is UNCHANGED and still lives in its own tables:
 * MilkDelivery and FarmerPurchase are litres x rate and know nothing about
 * products. Only the SELLING of milk became a catalog product.
 */
const CATEGORIES: CategorySeed[] = [
  { id: "cat_beverages", name: "Beverages" },
  { id: "cat_bakery", name: "Bakery" },
  { id: "cat_milk", name: "Milk Shop" },
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
// BOTTLES PER PET - the owner's own matrix (answered 2026-08-17)
// ---------------------------------------------------------------------------

/**
 * A PET IS 12 BOTTLES HERE, NOT 24. Written down because every reference table
 * online says 24, and this shop's is 12 for most sizes. The number is PER BRAND
 * AND PER SIZE - it is not a constant, which is why it lives on the product's
 * unit row rather than anywhere global.
 *
 * Straight from the owner's answers. Where a size is missing from a brand's
 * row, that brand does not sell that size.
 *
 * GOURMET 1.5L HAS TWO PETS - 4 and 6. That is not a typo and not a conflict to
 * resolve: he genuinely buys both cases. Two units on one product is exactly
 * what the (productId, name) unique key allows, so they are named "pet 4" and
 * "pet 6" to keep them distinct on the bill.
 *
 * `size` reuses the EXISTING vocabulary ("half_litre" prints as "0.5L") rather
 * than introducing "500ml" alongside it, so the catalog does not end up showing
 * the same bottle under two spellings.
 */
const PET_MATRIX: {
  brand: string;
  subId: string;
  /** Present already in the catalog? Then reuse its id and only ADD units. */
  existing?: boolean;
  sizes: { size: string; label: string; pets: number[] }[];
}[] = [
  {
    brand: "Pepsi",
    subId: "sub_pepsi",
    existing: true,
    sizes: [
      { size: "250ml", label: "250ml", pets: [24] },
      { size: "350ml", label: "350ml", pets: [12] },
      { size: "half_litre", label: "0.5L", pets: [12] },
      { size: "1L", label: "1L", pets: [6] },
      { size: "1.5L", label: "1.5L", pets: [6] },
      { size: "2.25L", label: "2.25L", pets: [4] },
    ],
  },
  {
    brand: "Coke Cola",
    subId: "sub_coke_cola",
    existing: true,
    sizes: [
      { size: "250ml", label: "250ml", pets: [24] },
      { size: "350ml", label: "350ml", pets: [12] },
      { size: "half_litre", label: "0.5L", pets: [12] },
      { size: "1L", label: "1L", pets: [6] },
      { size: "1.5L", label: "1.5L", pets: [6] },
      { size: "2L", label: "2L", pets: [6] },
      { size: "2.25L", label: "2.25L", pets: [6] },
    ],
  },
  {
    brand: "Sprite",
    subId: "sub_sprite",
    sizes: [
      { size: "250ml", label: "250ml", pets: [24] },
      { size: "350ml", label: "350ml", pets: [12] },
      { size: "half_litre", label: "0.5L", pets: [12] },
      { size: "1L", label: "1L", pets: [6] },
      { size: "1.5L", label: "1.5L", pets: [6] },
      { size: "2L", label: "2L", pets: [6] },
      { size: "2.25L", label: "2.25L", pets: [6] },
    ],
  },
  // Dew / 7Up / Mirinda share one shape: no 2L, and a 4-bottle 2.25L pet.
  ...(["Dew", "7Up", "Mirinda"] as const).map((brand) => ({
    brand,
    subId: `sub_${slug(brand)}`,
    sizes: [
      { size: "250ml", label: "250ml", pets: [24] },
      { size: "350ml", label: "350ml", pets: [12] },
      { size: "half_litre", label: "0.5L", pets: [12] },
      { size: "1L", label: "1L", pets: [6] },
      { size: "1.5L", label: "1.5L", pets: [6] },
      { size: "2.25L", label: "2.25L", pets: [4] },
    ],
  })),
  // Gourmet is sold BY FLAVOUR. The four flavourless "Gourmet <size>" rows
  // already in the catalog are left exactly as they are - the owner deactivates
  // whichever set he does not use.
  ...(["Gourmet Cola", "Gourmet Lemon"] as const).map((brand) => ({
    brand,
    subId: "sub_gourmet",
    sizes: [
      { size: "300ml", label: "300ml", pets: [12] },
      { size: "half_litre", label: "0.5L", pets: [12] },
      { size: "1L", label: "1L", pets: [6] },
      { size: "1.5L", label: "1.5L", pets: [4, 6] },
      { size: "2.25L", label: "2.25L", pets: [4] },
    ],
  })),
  {
    brand: "Sting",
    subId: "sub_sting",
    sizes: [
      { size: "250ml", label: "250ml", pets: [24] },
      { size: "half_litre", label: "0.5L", pets: [12] },
    ],
  },
  {
    brand: "Fruitien Joy",
    subId: "sub_fruitien_joy",
    sizes: [
      { size: "200ml", label: "200ml", pets: [24] },
      { size: "1L", label: "1L", pets: [12] },
    ],
  },
  {
    brand: "Mojo",
    subId: "sub_mojo",
    sizes: [
      { size: "half_litre", label: "0.5L", pets: [12] },
      { size: "1L", label: "1L", pets: [6] },
    ],
  },
];

/** Local quarter: one product, one size, 12 to the pet. */
const LOCAL_QUARTER = { id: "prod_local_quarter", subId: "sub_local_quarter" };

/**
 * A pet unit row. Named "pet" when the product has one, "pet 4"/"pet 6" when it
 * has two - the name is what prints on the bill and what the till sends, so it
 * has to distinguish them.
 *
 * PRICE 0, like every seeded price. The owner sets what a case costs; we have
 * no business inventing it (same rule as stock and shop details).
 */
function petUnits(bottles: number[]): UnitSeed[] {
  return bottles.map((count) => ({
    name: bottles.length > 1 ? `pet ${count}` : "pet",
    baseFactor: count,
    price: 0,
  }));
}

const petBrandSubCategories: SubCategorySeed[] = [
  ...PET_MATRIX.filter(
    (brand) => !brand.existing && brand.subId !== "sub_gourmet"
  ).map((brand) => ({
    id: brand.subId,
    name: brand.brand,
    categoryId: "cat_beverages",
  })),
  { id: LOCAL_QUARTER.subId, name: "Local Quarter", categoryId: "cat_beverages" },
];

const petProducts: ProductSeed[] = [
  ...PET_MATRIX.flatMap((brand) =>
    brand.sizes.map(({ size, label, pets }) => ({
      // An EXISTING row keeps its id, so this only ADDS its pet units and the
      // owner's price survives (the seed is upsert-with-`update: {}`).
      id: `prod_${slug(brand.brand)}_${slug(size)}`,
      name: `${brand.brand} ${label}`,
      subCategoryId: brand.subId,
      size,
      qualityTier: null,
      shape: null,
      unit: "bottle",
      units: petUnits(pets),
    }))
  ),
  {
    id: LOCAL_QUARTER.id,
    name: "Local Quarter",
    subCategoryId: LOCAL_QUARTER.subId,
    size: null,
    qualityTier: null,
    shape: null,
    unit: "bottle",
    units: petUnits([12]),
  },
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

  /**
   * EGGS - one stock pool counted in SINGLE EGGS, sold in three packs.
   *
   * The owner's rule, verbatim (2026-08-17): "The eggs stocks must be in single
   * eggs like 1000 eggs or whatever, when dozen sales (reduce stock by 12),
   * tray sales (reduce stock by 30), when peti sales (reduce stocks by 360)."
   *
   * So `unit` is "egg", not "cotton": the base unit is what STOCK is counted
   * in, and every factor below is relative to it. A peti is 12 trays = 360
   * eggs, which is the number that leaves the pool.
   *
   * The existing `prod_eggs` row keeps `unit: "cotton"` - this seed is additive
   * and never overwrites (`update: {}`). Change the label in the catalog UI if
   * the owner wants it; the UNITS are what the stock maths reads, and those are
   * added by this run.
   *
   * Prices are the owner's placeholders from the same answer (200 / 500 /
   * 7000), not invented ones.
   */
  {
    id: "prod_eggs",
    name: "Eggs",
    subCategoryId: "sub_eggs",
    size: null,
    qualityTier: null,
    shape: null,
    unit: "egg",
    units: [
      { name: "dozen", baseFactor: 12, price: 200 },
      { name: "tray", baseFactor: 30, price: 500 },
      { name: "peti", baseFactor: 360, price: 7000 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Milk — ONE product, sold by the litre
// ---------------------------------------------------------------------------

const milkSubCategories: SubCategorySeed[] = [
  { id: "sub_milk", name: "Milk", categoryId: "cat_milk" },
];

/**
 * Milk is a single product, priced per litre, with the rate overridable at
 * billing like any other product.
 *
 * 🔴 `stock: 0`, NOT the schema default of 100 — and this is the one product
 * where that default is actively wrong. Every other product's 100 is a
 * placeholder the owner replaces by counting the shelf. Milk's stock is
 * DERIVED: deliveries from farmers add to it (the delivery-to-stock bridge in
 * lib/milk-stock.ts) and sales subtract. Seeding 100 would invent a hundred
 * litres that never arrived, and the first real delivery would make the number
 * wrong rather than right.
 *
 * `unit: "litre"` is load-bearing for the UI: SELF_EVIDENT_UNITS in
 * lib/sale-catalog.ts holds only "bottle" and "piece", so "litre" counts as
 * informative and the sale form labels the field "Quantity (litres)" — the same
 * treatment eggs get for cottons.
 */
const milkProducts: ProductSeed[] = [
  {
    id: "prod_milk",
    name: "Milk",
    subCategoryId: "sub_milk",
    size: null,
    qualityTier: null,
    shape: null,
    unit: "litre",
    stock: 0,
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// Exported so the data can be inspected/counted without opening a connection.
export const SUB_CATEGORIES = [
  ...beverageSubCategories,
  ...petBrandSubCategories,
  ...bakerySubCategories,
  ...milkSubCategories,
];
/**
 * MERGE BY ID, DO NOT CONCATENATE.
 *
 * Pepsi and Coke Cola appear in BOTH lists: `beverageProducts` has carried
 * their four original sizes since Phase 2, and the pet matrix names the same
 * four again because the owner sells cases of them. Listing a product twice
 * would be harmless at runtime (the second upsert is a no-op under
 * `update: {}`) but it makes every count wrong and hides the overlap.
 *
 * The FIRST entry wins on fields - the Phase 2 row is the one whose id the
 * database already holds - and the units of both are kept, so the existing
 * bottle row simply gains its pet.
 */
function mergeById(products: ProductSeed[]): ProductSeed[] {
  const byId = new Map<string, ProductSeed>();
  for (const product of products) {
    const existing = byId.get(product.id);
    if (!existing) {
      byId.set(product.id, product);
      continue;
    }
    existing.units = [...(existing.units ?? []), ...(product.units ?? [])];
  }
  return Array.from(byId.values());
}

export const PRODUCTS = mergeById([
  ...beverageProducts,
  ...petProducts,
  ...bakeryProducts,
  ...milkProducts,
]);
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
    // `stock` is optional on ProductSeed: omitted -> the schema default of 100
    // (the placeholder the owner replaces by counting the shelf); present ->
    // that exact value, which is how milk starts at 0. Spreading `product`
    // directly would pass `stock: undefined` for the others, and Prisma treats
    // an explicit undefined as "not provided", so the default still applies —
    // but being explicit here keeps the intent readable.
    const { stock, units, ...fields } = product;
    await prisma.product.upsert({
      where: { id: product.id },
      update: {},
      create: {
        ...fields,
        price: 0,
        isActive: true,
        ...(stock === undefined ? {} : { stock }),
      },
    });

    // Units are upserted SEPARATELY rather than nested in the create above,
    // because a product that already exists takes `update: {}` and would never
    // reach a nested create - and the whole point of this pass is to add pets
    // to rows the owner has been using since Phase 2.
    //
    // `update: {}` here too: once a unit exists, its factor and price are the
    // owner's. A re-run must not reset a case price he typed in.
    for (const unit of units ?? []) {
      await prisma.productUnit.upsert({
        where: { productId_name: { productId: product.id, name: unit.name } },
        update: {},
        create: { productId: product.id, ...unit },
      });
    }
  }

  console.log(
    `Seed complete: ${CATEGORIES.length} categories, ` +
      `${SUB_CATEGORIES.length} sub-categories, ${PRODUCTS.length} products, ` +
      `${PRODUCTS.reduce((n, p) => n + (p.units?.length ?? 0), 0)} selling units.`
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
