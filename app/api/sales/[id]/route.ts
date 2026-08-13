import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { fail, ok, requireOwner, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  StockConflictError,
  applyStockDeltas,
  computeStockDeltas,
} from "@/lib/sales";
import { serialize } from "@/lib/serialize";
import { UNIFIED_SALE_DETAIL_SELECT } from "@/lib/unified-sales";

// Prisma cannot run on Edge (Gotcha 3).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

/**
 * GET /api/sales/[id] — one unified sale with its lines.
 *
 * Every figure comes from the line's own stored snapshot (`unitPrice`,
 * `lineTotal`, `netLineTotal`); the product join supplies the NAME only and
 * `Product.price` is never read here (Gotcha 5). `moduleKey` is likewise the
 * stored snapshot, never re-derived from the product's current category — a
 * product moved between sub-categories must not re-attribute a closed sale.
 */
export async function GET(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const sale = await prisma.sale.findUnique({
      where: { id: params.id },
      select: UNIFIED_SALE_DETAIL_SELECT,
    });
    if (!sale) return fail("That sale no longer exists.", 404);

    // Decimals -> numbers at the boundary (Gotcha 2).
    return ok(serialize(sale));
  } catch (error) {
    return serverError("sales.[id].GET", error);
  }
}

/**
 * DELETE /api/sales/[id] — remove a unified sale and RESTORE its stock.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ROUTE EXISTS AT ALL (it closes a real gap)
 * ---------------------------------------------------------------------------
 * Until now the unified endpoint had no DELETE, so the only way to remove a
 * unified sale was a raw `prisma.sale.delete` — which does NOT give stock back.
 * The per-module routes have always restored on delete; this brings the unified
 * path level with them, using the SAME `computeStockDeltas` / `applyStockDeltas`
 * pair rather than a second restock implementation. Found while testing the milk
 * bridge; see REMAINING-WORK.md S4.
 *
 * Every delta here is POSITIVE (a removed line gives its full stored quantity
 * back), which is why a delete can never be short of stock and needs no
 * shortfall pre-check.
 *
 * ---------------------------------------------------------------------------
 * 🔴 `Number(line.quantity)` IS LOAD-BEARING. DO NOT REMOVE IT.
 * ---------------------------------------------------------------------------
 * `SaleItem.quantity` is `Decimal(10,2)` (Migration C), while `StockDeltas` is
 * `Map<string, number>` and `computeStockDeltas` accumulates with
 * `(deltas.get(id) ?? 0) + amount`. Hand it a `Prisma.Decimal` and JavaScript
 * resolves the `+` through `valueOf()`, which decimal.js returns as a STRING —
 * so `0 + Decimal(12.5)` is the string `"012.5"`, not `12.5`.
 *
 * It does not throw and it does not fail to compile (`ExistingSaleLine` is a
 * hand-written type this route fills in itself), it just silently restocks the
 * wrong amount. The per-module DELETE never meets this because
 * `BeverageSaleItem.quantity` is an `Int`. Same boundary-normalisation rule as
 * `loadUnifiedSaleProducts` applies to `stock` (Gotcha 2).
 */
export async function DELETE(
  _request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const sale = await prisma.sale.findUnique({
      where: { id: params.id },
      // The line productIds and quantities are what gets GIVEN BACK to stock —
      // fetched rather than counted, because a deleted sale must return exactly
      // what it took.
      select: {
        id: true,
        items: { select: { id: true, productId: true, quantity: true } },
        _count: { select: { items: true } },
      },
    });
    if (!sale) return fail("That sale no longer exists.", 404);

    const stockDeltas = computeStockDeltas(
      sale.items.map((line) => ({
        id: line.id,
        productId: line.productId,
        // 🔴 See the docblock above. Never pass the Decimal through.
        quantity: Number(line.quantity),
        // Not used by the stock maths; present to satisfy ExistingSaleLine.
        unitPrice: new Prisma.Decimal(0),
        discountPercent: new Prisma.Decimal(0),
      })),
      { updates: [], creates: [], removedIds: sale.items.map((line) => line.id) }
    );

    await prisma.$transaction(
      async (tx) => {
        // `SaleItem.sale` is `onDelete: Cascade`, so the database would clear
        // the lines on its own — the explicit ordered delete is the same stance
        // the per-module routes and lib/catalog-guards.ts take: we never let the
        // database decide what goes.
        await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
        await tx.sale.delete({ where: { id: sale.id } });
        // Same transaction as the deletion: the sale and the restock commit
        // together or not at all.
        await applyStockDeltas(tx, stockDeltas);
      },
      // One statement per product restored, and a bill may hold up to 100 lines.
      // Over a pooled Supabase connection that can outrun Prisma's 5s default.
      { timeout: 15_000, maxWait: 5_000 }
    );

    return ok({
      deleted: "hard" as const,
      id: sale.id,
      itemCount: sale._count.items,
    });
  } catch (error) {
    /**
     * A restore is always a positive delta, so the conditional update's
     * `stock >= -delta` guard cannot refuse it — the only way to match zero rows
     * is the PRODUCT itself having gone. Products are soft-deleted when they
     * have sale history, so this should be unreachable; it is answered as a 409
     * with an actionable sentence rather than a 500, because nothing is broken.
     */
    if (error instanceof StockConflictError) {
      return fail(
        "This sale's stock couldn't be restored because one of its products no longer exists in the catalog. Recreate that product, then delete the sale.",
        409
      );
    }
    return serverError("sales.[id].DELETE", error);
  }
}
