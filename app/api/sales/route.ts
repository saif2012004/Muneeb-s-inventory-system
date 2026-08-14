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
  SALE_LIST_ORDER,
  StockConflictError,
  applyStockDeltas,
  buildSaleDateWindow,
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
  UNIFIED_SALE_LIST_SELECT,
  UNIFIED_SALE_PRODUCT_SELECT,
  loadUnifiedSaleProducts,
  toUnifiedSaleListRow,
} from "@/lib/unified-sales";
import { saleListQuerySchema } from "@/lib/validations/sales";
import { unifiedSaleCreateSchema } from "@/lib/validations/unified-sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sales — list unified sales, newest first.
 *
 * Query params (all optional): customerId · dateFrom · dateTo · page · limit.
 *
 * Deferred from S3 and built in S4 because the unified SCREEN needs it. It
 * reuses the per-module list plumbing WHOLESALE — `saleListQuerySchema`,
 * `buildSaleDateWindow`, `SALE_LIST_SELECT` (via `UNIFIED_SALE_LIST_SELECT`),
 * `SALE_LIST_ORDER` and `toSaleListRow` — rather than restating filtering or
 * pagination for a second table. Karachi day filtering therefore behaves
 * identically here and on `/api/beverages/sales` because it is the same code
 * (Gotcha 4).
 *
 * The one thing it adds is `modules` per row, resolved from the joined line
 * `moduleKey`s. See `UNIFIED_SALE_LIST_SELECT` for why that costs no extra
 * round trip.
 *
 * QUERY BUDGET: 2 statements (page + count), the same as the per-module lists.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const parsed = saleListQuerySchema.safeParse({
      customerId: searchParams.get("customerId") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { customerId, dateFrom, dateTo, page, limit } = parsed.data;

    const window = buildSaleDateWindow(dateFrom, dateTo);
    if (isSaleProblem(window)) return fail(window.message, window.status);

    const where: Prisma.SaleWhereInput = {
      ...(customerId ? { customerId } : {}),
      ...(window ? { saleDate: window } : {}),
    };

    // One transaction so the page and the total cannot disagree about how many
    // rows exist — otherwise a sale created between the two queries makes the
    // pager offer a page that isn't there.
    const [sales, total] = await prisma.$transaction([
      prisma.sale.findMany({
        where,
        select: UNIFIED_SALE_LIST_SELECT,
        orderBy: [...SALE_LIST_ORDER],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sale.count({ where }),
    ]);

    return ok({
      // `totalAmount` is a Decimal — an OBJECT, not a number (Gotcha 2).
      sales: sales.map((sale) => serialize(toUnifiedSaleListRow(sale))),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return serverError("sales.GET", error);
  }
}

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

    const noCharge = items.find(
      (item) => item.chilled && !products.get(item.productId)!.coolingCharge
    );
    if (noCharge) {
      const product = products.get(noCharge.productId)!;
      return fail(
        `"${product.name}" has no cooling charge set in the catalog, so it can't be billed as chilled. Set one on the product first.`,
        400
      );
    }

    const lines = items.map((item) => {
      // Non-null: loadUnifiedSaleProducts already proved every id resolves.
      const product = products.get(item.productId)!;

      // Create-only override (Gotcha 5): an explicit unitPrice wins here and
      // ONLY here. The update path ignores a client price for an existing line.
      const unitPrice = snapshotUnitPrice(product, item.unitPrice);

      /**
       * COOLING (Migration E). The client sends a BOOLEAN; the rate is read off
       * the catalog row, never from the request — one place the number lives.
       *
       * `chilled` on a product with no charge is a 400 rather than a silent 0:
       * it means a toggle was offered that should not exist, and charging
       * nothing while pretending to have chilled it hides the bug.
       */
      const coolingRate =
        item.chilled && product.coolingCharge
          ? product.coolingCharge
          : new Prisma.Decimal(0);

      // `item.quantity` is the VALIDATED REQUEST VALUE, passed straight through.
      // Never a derived one: decimal.js builds from a number's shortest decimal
      // form, so a 2dp input is exact — but float noise in a COMPUTED value
      // (0.1 + 0.2 -> 0.30000000000000004) would survive into the money.
      // The discount argument is omitted, so it defaults to 0.
      //
      // A chilled line simply costs more PER UNIT, so the charge is folded into
      // the price handed to the SAME `computeLineTotal` every other sale uses —
      // no second money implementation, and `netLineTotal === lineTotal` and
      // `totalAmount === Σ netLineTotal` both stay true by construction.
      const lineTotal = computeLineTotal(unitPrice.add(coolingRate), item.quantity);

      return {
        productId: item.productId,
        moduleKey: product.moduleKey,
        coolingRate,
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
      // Snapshotted like the price: a later catalog change must not move a
      // printed bill. 0 when the line was not chilled.
      coolingRate: line.coolingRate,
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
