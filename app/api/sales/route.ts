import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  fail,
  failStockBlocked,
  firstIssue,
  ok,
  requireOwner,
  serverError,
} from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  StockConflictError,
  applyStockDeltas,
  checkTotalFits,
  computeLineTotal,
  computeSaleTotal,
  computeStockDeltas,
  findStockShortfalls,
  isSaleProblem,
  snapshotUnitPrice,
  stockBlockMessage,
} from "@/lib/sales";
import { serialize } from "@/lib/serialize";
import {
  UNIFIED_SALE_DETAIL_SELECT,
  UNIFIED_SALE_PRODUCT_SELECT,
  loadUnifiedSaleProducts,
} from "@/lib/unified-sales";
import { unifiedSaleCreateSchema } from "@/lib/validations/unified-sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sales — create a UNIFIED sale.
 *
 * One bill, lines from any module. Each line snapshots the module it was sold
 * as (`SaleItem.moduleKey`), so per-module revenue survives a mixed bill —
 * which a sale-level SUM over BeverageSale/BakerySale structurally cannot.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ENDPOINT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * NO DISCOUNTS, at line or bill level. The request schema is `.strict()`, so
 * sending `discountPercent` is a 400 rather than a silent drop. That is not a
 * simplification to be "completed" later without thought: with no discount,
 *
 *     netLineTotal === lineTotal                        per line, by definition
 *     totalAmount  === Σ lineTotal === Σ netLineTotal   exactly, no residue
 *
 * so the Σ-invariant holds BY CONSTRUCTION. Reintroducing a bill discount means
 * apportioning it across lines pro-rata with the rounding residue landing
 * somewhere deliberate — the single most error-prone piece of this rework. If it
 * is ever wanted, design it as its own change.
 *
 * MILK IS DORMANT. A milk line would work today — `moduleKey` resolves from the
 * product's category, quantity is decimal (Migration C) and stock is decimal
 * (Migration D) — but no Milk Shop category or milk Product exists yet, so
 * nothing can resolve to "milk". That product arrives in its own gated stage and
 * needs NO change here.
 *
 * The per-module routes are untouched and still live. Both paths work.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => null);
    const parsed = unifiedSaleCreateSchema.safeParse(body);
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { customerId, saleDate, notes, items } = parsed.data;

    // Checked up front so a bad customer id surfaces as a sentence rather than
    // a raw foreign-key violation from the write.
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) return fail("That customer no longer exists.", 404);

    const products = await loadUnifiedSaleProducts(
      items.map((item) => item.productId),
      (ids) =>
        prisma.product.findMany({
          where: { id: { in: ids } },
          select: UNIFIED_SALE_PRODUCT_SELECT,
        })
    );
    if (isSaleProblem(products)) return fail(products.message, products.status);

    const lines = items.map((item) => {
      // Non-null: loadUnifiedSaleProducts already proved every id resolves.
      const product = products.get(item.productId)!;

      // Create-only override (Gotcha 5): an explicit unitPrice wins here and
      // ONLY here. There is no unified update path yet, and when one is built it
      // must ignore the client price for an existing line.
      const unitPrice = snapshotUnitPrice(product, item.unitPrice);

      // `item.quantity` is the VALIDATED REQUEST VALUE, passed straight through.
      // Never a derived one: decimal.js builds from a number's shortest decimal
      // form, so a 2dp input is exact — but float noise in a COMPUTED value
      // (0.1 + 0.2 -> 0.30000000000000004) would survive into the money.
      // The discount argument is omitted, so it defaults to 0.
      const lineTotal = computeLineTotal(unitPrice, item.quantity);

      return {
        productId: item.productId,
        moduleKey: product.moduleKey,
        // A NUMBER, not a Decimal: this same object feeds `computeStockDeltas`,
        // whose SaleLine contract is `quantity: number` because it does plain
        // arithmetic on it (`prior.quantity - line.quantity`). Prisma accepts a
        // number for the Decimal column, and a validated 2dp value is exact.
        quantity: item.quantity,
        unitPrice,
        // Required by SaleLine and always zero here. It is deliberately NOT
        // written to the database — see the write payload below.
        discountPercent: new Prisma.Decimal(0),
        lineTotal,
        // No discount on this endpoint, so the net contribution IS the line
        // total. Written explicitly because the column is NOT NULL with no
        // default.
        netLineTotal: lineTotal,
      };
    });

    const { total: totalAmount } = computeSaleTotal(
      lines,
      new Prisma.Decimal(0)
    );
    const tooLarge = checkTotalFits(totalAmount);
    if (tooLarge) return fail(tooLarge.message, tooLarge.status);

    /**
     * STOCK. On a create every line simply takes its quantity, so the delta is
     * the reconciliation against nothing — the SAME function the per-module and
     * edit paths use, rather than a special case written a third time.
     *
     * Milk lines decrement stock like any other product line. That is what
     * Migration D widened the column for. (Farmer deliveries INCREASING milk
     * stock is the separate delivery-to-stock bridge, not this.)
     */
    const stockDeltas = computeStockDeltas([], {
      updates: [],
      creates: lines,
      removedIds: [],
    });
    const shortfalls = findStockShortfalls(stockDeltas, products);
    if (shortfalls.length > 0) {
      // All-or-nothing: refused before the transaction opens, so no Sale row is
      // created and NO line's stock moves — not even the satisfiable ones.
      return failStockBlocked(stockBlockMessage(shortfalls), shortfalls);
    }

    /**
     * The WRITE payload, built explicitly rather than spreading `lines`.
     *
     * `discountPercent` is dropped here on purpose: both `Sale.discountPercent`
     * and `SaleItem.discountPercent` are NOT NULL DEFAULT 0, so omitting them
     * lets the database supply the zero. Writing an explicit 0 would store the
     * same number while implying this endpoint has a discount concept it chose
     * to set to zero — it does not have one at all.
     */
    const itemWrites = lines.map((line) => ({
      productId: line.productId,
      moduleKey: line.moduleKey,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      netLineTotal: line.netLineTotal,
    }));

    const created = await prisma.$transaction(
      async (tx) => {
        // Stock FIRST: its conditional update aborts the whole transaction
        // before any sale row exists, rather than after.
        await applyStockDeltas(tx, stockDeltas);
        return tx.sale.create({
          data: {
            customerId,
            saleDate,
            notes: notes ?? null,
            totalAmount,
            items: { create: itemWrites },
          },
          // MINIMAL select. The detail read-back happens outside, so the
          // transaction holds only the writes — at ~1.1s per round trip a deep
          // join in here spends the timeout budget holding row locks.
          select: { id: true },
        });
      },
      { timeout: 15_000, maxWait: 5_000 }
    );

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: created.id },
      select: UNIFIED_SALE_DETAIL_SELECT,
    });

    return ok(serialize(sale), 201);
  } catch (error) {
    // Stock moved between the pre-check and the write. Nothing is broken — the
    // number changed — so it is a 409 "reload and try again", not a 500.
    if (error instanceof StockConflictError) {
      return fail(error.message, 409);
    }
    return serverError("sales.POST", error);
  }
}
