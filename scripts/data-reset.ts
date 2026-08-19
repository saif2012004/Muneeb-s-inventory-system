/**
 * THE ONE DELIBERATE DATA RESET BEFORE GO-LIVE (CHECKLIST #2).
 *
 * ---------------------------------------------------------------------------
 * 🔴 THIS DELETES THE OWNER'S TRANSACTIONAL HISTORY. IT IS IRREVERSIBLE
 *    WITHOUT THE BACKUP.
 * ---------------------------------------------------------------------------
 *
 * Run it ONCE, at handover, with the delete set confirmed by the owner first.
 * Piecemeal cleanup is how a row that turned out to matter gets lost, which is
 * why every verification pass during the build was `ZZ_TEST_`-scoped — so that
 * this could be a single decision at the end rather than a series of small ones.
 *
 *   npx tsx scripts/data-reset.ts              # DRY RUN — counts only, no writes
 *   npx tsx scripts/data-reset.ts --confirm    # actually deletes
 *
 * The dry run is the default deliberately. A script whose destructive path is
 * the one you get by typing its name is a script that eventually runs by
 * accident.
 */
import { prisma } from "@/lib/prisma";

const CONFIRM = process.argv.includes("--confirm");
/** Stock and price are the owner's to set; see the note in the summary below. */
const ZERO_STOCK = process.argv.includes("--zero-stock");
const ZERO_PRICES = process.argv.includes("--zero-prices");

/**
 * DELETION ORDER IS LOAD-BEARING — it follows the foreign keys.
 *
 *   SaleItem   → cascades from Sale (onDelete: Cascade), so it is not listed
 *   Sale       → must go BEFORE Customer (Sale.customer has NO cascade)
 *   deliveries
 *   + purchases→ must go BEFORE Farmer (neither has a cascade)
 *
 * Get this wrong and Postgres refuses with a foreign-key violation — which is
 * the safe failure, but a failure that stops the reset half-done.
 */
async function main() {
  console.log(CONFIRM ? "\n🔴 LIVE RUN — deleting\n" : "\n🔍 DRY RUN — nothing will be written\n");

  const before = await counts();
  console.log("BEFORE:");
  table(before);

  if (!CONFIRM) {
    console.log("\nWould delete: Sale, SaleItem (cascade), CustomerPayment, Customer,");
    console.log("              MilkDelivery, FarmerPurchase, Farmer");
    console.log("Would KEEP:   User, Settings, Category, SubCategory, Product, ProductUnit");
    if (ZERO_STOCK) console.log("Would ALSO:   set every product's stock to 0");
    if (ZERO_PRICES) console.log("Would ALSO:   set every product's price to 0");
    console.log("\nRe-run with --confirm to execute.\n");
    await prisma.$disconnect();
    return;
  }

  // One transaction: a half-applied reset would leave orphaned money.
  await prisma.$transaction(async (tx) => {
    await tx.sale.deleteMany({}); // SaleItem cascades
    await tx.customerPayment.deleteMany({});
    await tx.customer.deleteMany({});
    await tx.milkDelivery.deleteMany({});
    await tx.farmerPurchase.deleteMany({});
    await tx.farmer.deleteMany({});

    if (ZERO_STOCK) await tx.product.updateMany({ data: { stock: 0 } });
    if (ZERO_PRICES) await tx.product.updateMany({ data: { price: 0 } });
  });

  const after = await counts();
  console.log("\nAFTER:");
  table(after);

  // The catalog and the login must be UNTOUCHED. Verified, not assumed — this
  // is the one thing that would make the reset a disaster rather than a reset.
  const kept =
    after.User === before.User &&
    after.Settings === before.Settings &&
    after.Product === before.Product &&
    after.ProductUnit === before.ProductUnit &&
    after.Category === before.Category &&
    after.SubCategory === before.SubCategory;
  console.log(kept ? "\n✅ catalog + login intact" : "\n🔴 CATALOG CHANGED — investigate before going further");

  await prisma.$disconnect();
}

async function counts() {
  return {
    Sale: await prisma.sale.count(),
    SaleItem: await prisma.saleItem.count(),
    Customer: await prisma.customer.count(),
    CustomerPayment: await prisma.customerPayment.count(),
    Farmer: await prisma.farmer.count(),
    MilkDelivery: await prisma.milkDelivery.count(),
    FarmerPurchase: await prisma.farmerPurchase.count(),
    Product: await prisma.product.count(),
    ProductUnit: await prisma.productUnit.count(),
    Category: await prisma.category.count(),
    SubCategory: await prisma.subCategory.count(),
    Settings: await prisma.settings.count(),
    User: await prisma.user.count(),
  };
}

function table(c: Record<string, number>) {
  for (const [k, v] of Object.entries(c)) console.log(`  ${k.padEnd(18)} ${String(v).padStart(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
