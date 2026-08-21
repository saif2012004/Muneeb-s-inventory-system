/**
 * ONE-OFF CATALOG CORRECTION (2026-08-21): the biscuits are sold BY WEIGHT.
 *
 * The owner's rule: Biscuits Premium and Biscuits Simple are weighed off a
 * scale, so the base unit is the KILOGRAM and the stock pool is kilograms. A
 * customer buying 200 g is the ordinary decimal quantity 0.2, which the unified
 * till and `SaleItem.quantity numeric(10,2)` have handled since milk arrived.
 *
 *   npx tsx scripts/biscuits-to-kg.ts             # DRY RUN — prints the diff
 *   npx tsx scripts/biscuits-to-kg.ts --confirm   # applies it
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SCRIPT AND NOT A SEED CHANGE
 * ---------------------------------------------------------------------------
 * `prisma/seed.ts` is ADDITIVE — every product is an `upsert` with `update: {}`
 * — so it can create these rows correctly on a fresh database but can never
 * change one that already exists. That is deliberate: the seed must not
 * overwrite a price or a stock count the owner has set. It is the same reason
 * `prod_eggs.unit` needed a manual change from "cotton" to "egg" on 2026-08-18.
 * The seed has been updated too, for the next fresh database.
 *
 * ---------------------------------------------------------------------------
 * 🔴 STOCK IS RESET TO 0, ON PURPOSE
 * ---------------------------------------------------------------------------
 * Both rows carry the seed placeholder of 100 and 95 PIECES. Those numbers do
 * not survive the change of unit — reinterpreted as kilograms they would claim
 * ~100 kg of biscuits that nobody has weighed, and the till would sell against
 * it. A measured quantity must be counted, never inherited from a placeholder
 * that meant something else. Zero blocks the sale and puts the catalog's inline
 * stock editor in front of the owner, which is the recoverable failure.
 */
import { prisma } from "@/lib/prisma";

const CONFIRM = process.argv.includes("--confirm");
const IDS = ["prod_biscuits_premium", "prod_biscuits_simple"];

async function main() {
  console.log(CONFIRM ? "\n🔴 LIVE RUN\n" : "\n🔍 DRY RUN — nothing will be written\n");

  const before = await rows();
  if (before.length !== IDS.length) {
    console.error(`🔴 expected ${IDS.length} biscuit rows, found ${before.length}. STOPPING.`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  console.log("BEFORE:");
  for (const p of before) {
    console.log(`  ${p.id.padEnd(24)} unit=${String(p.unit).padEnd(6)} stock=${p.stock} price=${p.price}`);
  }
  console.log("\nCHANGE: unit -> 'kg', stock -> 0. Price, name and sale history untouched.");

  // History check — a base unit is read LIVE off the product on a reprint, so
  // say plainly how many closed lines will start printing "kg".
  const affected = await prisma.saleItem.count({ where: { productId: { in: IDS } } });
  if (affected > 0) {
    console.log(
      `\n⚠️  ${affected} existing sale line(s) reference these products. Their MONEY is` +
        `\n    snapshotted and cannot move, but a reprint reads the base unit live, so` +
        `\n    those lines will print "N kg" instead of a bare "N".`
    );
  }

  if (!CONFIRM) {
    console.log("\nRe-run with --confirm to apply.\n");
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(
    IDS.map((id) => prisma.product.update({ where: { id }, data: { unit: "kg", stock: 0 } }))
  );

  console.log("\nAFTER:");
  for (const p of await rows()) {
    console.log(`  ${p.id.padEnd(24)} unit=${String(p.unit).padEnd(6)} stock=${p.stock} price=${p.price}`);
  }

  // Nothing outside these two rows may have moved.
  const total = await prisma.product.count();
  console.log(`\nProduct rows: ${total} (unchanged by this script — it only updates 2)`);
  await prisma.$disconnect();
}

function rows() {
  return prisma.product.findMany({
    where: { id: { in: IDS } },
    select: { id: true, name: true, unit: true, stock: true, price: true },
    orderBy: { id: "asc" },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
