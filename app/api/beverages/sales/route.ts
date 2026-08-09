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
import { resolveModuleCategoryId } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import {
  SALE_DETAIL_SELECT,
  SALE_LIST_ORDER,
  SALE_LIST_SELECT,
  SALE_PRODUCT_SELECT,
  buildSaleDateWindow,
  checkTotalFits,
  applyStockDeltas,
  computeLineTotal,
  computeSaleTotal,
  computeStockDeltas,
  findStockShortfalls,
  isSaleProblem,
  stockBlockMessage,
  loadSaleProducts,
  snapshotUnitPrice,
  toSaleListRow,
  type SaleLine,
} from "@/lib/sales";
import { serialize } from "@/lib/serialize";
import { saleCreateSchema, saleListQuerySchema } from "@/lib/validations/sales";

// Prisma cannot run on Edge (Gotcha 3).
export const runtime = "nodejs";
// `auth()` reads cookies so this is dynamic anyway; stated explicitly so a
// future edit can't accidentally let Next cache a sales list.
export const dynamic = "force-dynamic";

/**
 * GET /api/beverages/sales
 *
 * Query params (all optional):
 *   customerId   restrict to one customer's sales
 *   dateFrom     inclusive, a Karachi calendar day ("2026-08-03")
 *   dateTo       inclusive, a Karachi calendar day
 *   page         1-based, default 1
 *   limit        default 10, max 100
 *
 * DATE FILTERING IS KARACHI-BASED (Gotcha 4). `dateTo` is turned into the UTC
 * instant of the START of the FOLLOWING Karachi day and compared with `lt`, so
 * the named day is fully included without `lte` double-counting a sale landing
 * exactly on midnight.
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

    const where: Prisma.BeverageSaleWhereInput = {
      ...(customerId ? { customerId } : {}),
      ...(window ? { saleDate: window } : {}),
    };

    // One transaction so the page and the total can't disagree about how many
    // rows exist — otherwise a sale created between the two queries makes the
    // pager show a page that isn't there.
    const [sales, total] = await prisma.$transaction([
      prisma.beverageSale.findMany({
        where,
        select: SALE_LIST_SELECT,
        orderBy: [...SALE_LIST_ORDER],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.beverageSale.count({ where }),
    ]);

    return ok({
      // `totalAmount` is a Decimal — an OBJECT, not a number (Gotcha 2).
      sales: sales.map((sale) => serialize(toSaleListRow(sale))),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return serverError("beverages.sales.GET", error);
  }
}

/**
 * POST /api/beverages/sales
 *
 * Body: { customerId, saleDate, notes?, items: [{ productId, quantity, unitPrice? }] }
 *
 * PRICE SNAPSHOT (Gotcha 5): each line copies the CURRENT `Product.price` into
 * its own `unitPrice`, unless the body passes an explicit `unitPrice` override
 * — which it will often need to, because the seed ships all 62 products at 0.
 * `lineTotal` and `totalAmount` are computed here from Decimals and are never
 * accepted from the client.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = saleCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { customerId, saleDate, notes, discountPercent, items } = parsed.data;

    const categoryId = await resolveModuleCategoryId("beverages");
    if (!categoryId) {
      return fail(
        "There's no Beverages category in the catalog yet. Add one before recording beverage sales.",
        409
      );
    }

    // Checked up front so a bad customer id surfaces as a sentence rather than
    // a raw foreign-key violation from the write.
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) return fail("That customer no longer exists.", 404);

    const products = await loadSaleProducts(
      items.map((item) => item.productId),
      {
        categoryId,
        moduleLabel: "Beverages",
        findMany: (ids) =>
          prisma.product.findMany({
            where: { id: { in: ids } },
            select: SALE_PRODUCT_SELECT,
          }),
      }
    );
    if (isSaleProblem(products)) return fail(products.message, products.status);

    const lines: SaleLine[] = items.map((item) => {
      // Non-null: loadSaleProducts already proved every id resolves.
      const product = products.get(item.productId)!;
      const unitPrice = snapshotUnitPrice(product, item.unitPrice);
      const lineDiscount = new Prisma.Decimal(item.discountPercent);
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        discountPercent: lineDiscount,
        lineTotal: computeLineTotal(unitPrice, item.quantity, lineDiscount),
      };
    });

    // Line discounts are already inside each lineTotal; this applies the
    // whole-bill discount to their subtotal. Order is fixed in lib/sales.ts.
    const { total: totalAmount } = computeSaleTotal(
      lines,
      new Prisma.Decimal(discountPercent)
    );
    const tooLarge = checkTotalFits(totalAmount);
    if (tooLarge) return fail(tooLarge.message, tooLarge.status);

    /**
     * STOCK. On a create every line simply takes its quantity, so the delta is
     * the reconciliation against nothing — the SAME function the edit path
     * uses, rather than a special case written twice.
     */
    const stockDeltas = computeStockDeltas([], {
      updates: [],
      creates: lines,
      removedIds: [],
    });
    const shortfalls = findStockShortfalls(stockDeltas, products);
    if (shortfalls.length > 0) {
      // Blocked — never negative stock, never warn-and-proceed.
      return failStockBlocked(stockBlockMessage(shortfalls), shortfalls);
    }

    // The nested `create` is atomic on its own, but stock must commit WITH it:
    // a sale recorded against stock that was never decremented is exactly the
    // drift this feature exists to prevent. The stock write goes first so its
    // conditional guard aborts before any sale row exists.
    const sale = await prisma.$transaction(async (tx) => {
      await applyStockDeltas(tx, stockDeltas);
      return tx.beverageSale.create({
        data: {
          customerId,
          saleDate,
          notes: notes ?? null,
          discountPercent,
          totalAmount,
          items: { create: lines },
        },
        select: SALE_DETAIL_SELECT,
      });
    });

    return ok(serialize(sale), 201);
  } catch (error) {
    return serverError("beverages.sales.POST", error);
  }
}
