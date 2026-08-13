import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { MILK_SALE_SELECT, computeMilkSaleTotal } from "@/lib/milk-sales";
import { prisma } from "@/lib/prisma";
import { getCustomerBalance } from "@/lib/receivables";
import { buildSaleDateWindow, checkTotalFits, isSaleProblem } from "@/lib/sales";
import { serialize } from "@/lib/serialize";
import { milkSaleCreateSchema } from "@/lib/validations/milk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILK SALES — milk the owner sells TO a customer (hotels, shops, individuals).
 * Money flows in. The mirror image of a MilkDelivery, and not to be confused
 * with one.
 *
 * ---------------------------------------------------------------------------
 * 🔴 POST IS RETIRED FROM THE UI — CUTOVER 2026-08-14 (S4.3)
 * ---------------------------------------------------------------------------
 * Milk selling moved to the unified till (`POST /api/sales`), which decrements
 * milk stock; this route does not and never did — `MilkSale` has no product FK.
 * `/milk/sales` is now a HISTORY screen: it can still list, edit and delete the
 * rows recorded before the move, but nothing in the app calls this POST.
 *
 * It is deliberately NOT deleted. The old per-module paths all retire together
 * at S9, after a soak, and removing one early would make that rollback partial.
 * **Do not wire a new screen to it, and do not add a stock decrement here** —
 * that would duplicate stock logic into a table scheduled to be dropped.
 *
 * GET stays fully live: the history screen and the CSV export both read it.
 *
 * ---------------------------------------------------------------------------
 * NOT A THIRD SALE MODULE
 * ---------------------------------------------------------------------------
 * This does not reuse `components/sales/`, `lib/sale-modules.ts` or
 * `reconcileSaleLines()`, and adding a third `SaleModule` row would be forcing
 * the wrong shape. A beverage or bakery sale is a basket of catalog products
 * with a price snapshot per line; a milk sale is ONE row of `liters × rate`
 * with no items table, no product FK and nothing to snapshot — the rate typed
 * here IS the historical record.
 *
 * What it DOES share is the customer and the receivable: `lib/receivables.ts`
 * has summed MilkSale since Phase 4b, so a sale recorded here lands in the
 * customer's outstanding balance and ledger with no change there.
 */

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * GET /api/milk/sales
 *
 * Query params (all optional):
 *   customerId  restrict to one customer
 *   dateFrom    inclusive Karachi calendar day ("2026-08-07")
 *   dateTo      inclusive Karachi calendar day
 *   page        1-based, default 1
 *   limit       default 20, max 100
 *
 * Date filtering reuses `buildSaleDateWindow` from lib/sales.ts — `dateTo`
 * becomes the start of the FOLLOWING Karachi day compared with `lt`, so the
 * named day is fully included without `lte` double-counting midnight (Gotcha 4).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);

    const window = buildSaleDateWindow(
      searchParams.get("dateFrom") ?? undefined,
      searchParams.get("dateTo") ?? undefined
    );
    if (isSaleProblem(window)) return fail(window.message, window.status);

    const customerId = searchParams.get("customerId")?.trim() || undefined;
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const limit = Math.min(
      parsePositiveInt(searchParams.get("limit"), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    );

    const where: Prisma.MilkSaleWhereInput = {
      ...(customerId ? { customerId } : {}),
      ...(window ? { saleDate: window } : {}),
    };

    // One transaction so the page and the total can't disagree about how many
    // rows exist — otherwise a sale created between the two queries makes the
    // pager offer a page that isn't there.
    const [sales, total, totals] = await prisma.$transaction([
      prisma.milkSale.findMany({
        where,
        select: MILK_SALE_SELECT,
        // createdAt breaks ties so paging can't repeat or skip a row.
        orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.milkSale.count({ where }),
      // Totals for the WHOLE filtered set, not just this page — "how much milk
      // did I sell this month" is the question the filter is asked for, and a
      // page-only total would answer a different one.
      prisma.milkSale.aggregate({
        where,
        _sum: { liters: true, totalAmount: true },
      }),
    ]);

    return ok({
      // Decimals -> numbers at the boundary (Gotcha 2).
      sales: serialize(sales),
      totals: {
        // `_sum` is null when nothing matched — that means zero, not "unknown".
        liters: serialize(totals._sum.liters ?? 0),
        amount: serialize(totals._sum.totalAmount ?? 0),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return serverError("milk.sales.GET", error);
  }
}

/**
 * POST /api/milk/sales
 *
 * Body: { customerId, saleDate, liters, ratePerLiter, notes? }
 *
 * `totalAmount` is computed here from Decimals and never accepted from the
 * client. The response carries the customer's recomputed balance so the UI can
 * show the new outstanding from the shared calculation rather than adding it up
 * in the browser.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = milkSaleCreateSchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { customerId, saleDate, liters, ratePerLiter, notes } = parsed.data;

    // Checked up front so a stale customer id surfaces as a sentence rather
    // than a raw foreign-key violation from the write.
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, isActive: true },
    });
    if (!customer) return fail("That customer no longer exists.", 404);
    if (!customer.isActive) {
      return fail(
        `"${customer.name}" is deactivated. Reactivate them before recording a sale.`,
        409
      );
    }

    const totalAmount = computeMilkSaleTotal(liters, ratePerLiter);

    // Reused from lib/sales.ts rather than re-deriving the Decimal(10,2)
    // ceiling: a total the column cannot hold must fail as a sentence, not as a
    // raw Prisma numeric-overflow error.
    const tooLarge = checkTotalFits(totalAmount);
    if (tooLarge) return fail(tooLarge.message, tooLarge.status);

    const sale = await prisma.milkSale.create({
      data: {
        customerId,
        saleDate,
        liters,
        ratePerLiter,
        totalAmount,
        notes: notes ?? null,
      },
      select: MILK_SALE_SELECT,
    });

    const balance = await getCustomerBalance(customerId);

    return ok(serialize({ sale, balance }), 201);
  } catch (error) {
    return serverError("milk.sales.POST", error);
  }
}
