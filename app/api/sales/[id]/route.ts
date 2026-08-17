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
  reconcileSaleLines,
  stockBlockMessage,
} from "@/lib/sales";
import { serialize } from "@/lib/serialize";
import {
  UNIFIED_SALE_DETAIL_SELECT,
  UNIFIED_SALE_PRODUCT_SELECT,
  loadUnifiedSaleProducts,
} from "@/lib/unified-sales";
import { unifiedSaleUpdateSchema } from "@/lib/validations/unified-sales";

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
 * PATCH /api/sales/[id] — edit a unified sale. (CHECKLIST #8)
 *
 * ---------------------------------------------------------------------------
 * WHAT `items` MEANS
 * ---------------------------------------------------------------------------
 * OMIT `items` and only the header changes — every line, and therefore every
 * price snapshot, is left exactly as it was. That is the safe edit.
 *
 * SEND `items` and it is the COMPLETE desired set of lines:
 *   entry WITH an `id`    -> that stored line, kept or edited
 *   entry WITHOUT an `id` -> a new line
 *   stored line absent    -> removed from the sale
 *
 * ---------------------------------------------------------------------------
 * NOTHING ABOUT THE MONEY RULES IS RE-IMPLEMENTED HERE
 * ---------------------------------------------------------------------------
 * `reconcileSaleLines` decides which lines keep their stored price and which
 * take a fresh one, and `computeStockDeltas` derives the stock movement FROM
 * that same reconciliation. Both are the functions the per-module PATCH has used
 * since Phase 3. So the rules hold here for free:
 *
 *   - a QUANTITY change keeps the stored `unitPrice` (a typo fix is not a
 *     re-sale, and re-pricing would silently move a historical total);
 *   - a PRODUCT swap re-snapshots FROM THE DATABASE;
 *   - a client `unitPrice` on an EXISTING line is IGNORED (CHECKLIST #7);
 *   - stock moves by the DIFFERENCE — 12 -> 8 frees 4, never -8.
 *
 * What this route adds on top is the two columns only the unified table has:
 * `moduleKey` (re-resolved per line from the product, because a line whose
 * PRODUCT changed may have changed shop too) and `netLineTotal` (equal to
 * `lineTotal` — this endpoint has no discounts).
 */
export async function PATCH(
  request: Request,
  { params }: Context
): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => null);
    const parsed = unifiedSaleUpdateSchema.safeParse(body);
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { saleDate, notes, items } = parsed.data;

    const existing = await prisma.sale.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPrice: true,
            // Kept, never recomputed: cooling is part of what was charged.
            coolingRate: true,
            // What it was sold AS and what stock moved by (S8). Both kept.
            unitName: true,
            unitFactor: true,
            discountPercent: true,
            lineTotal: true,
          },
        },
      },
    });
    if (!existing) return fail("That sale no longer exists.", 404);

    const header: Prisma.SaleUpdateInput = {};
    if (saleDate !== undefined) header.saleDate = saleDate;
    if (notes !== undefined) header.notes = notes ?? null;

    // ----- Header-only edit: lines untouched, total unchanged --------------
    // No bill discount exists on this endpoint, so unlike the per-module PATCH
    // there is nothing to re-foot: the stored total still equals Σ netLineTotal.
    if (items === undefined) {
      const sale = await prisma.sale.update({
        where: { id: existing.id },
        data: header,
        select: UNIFIED_SALE_DETAIL_SELECT,
      });
      return ok({ ...serialize(sale), repricedItemIds: [] as string[] });
    }

    // ----- Full line reconciliation ---------------------------------------
    const products = await loadUnifiedSaleProducts(
      items.map((item) => item.productId),
      (ids) =>
        prisma.product.findMany({
          where: { id: { in: ids } },
          select: UNIFIED_SALE_PRODUCT_SELECT,
        })
    );
    if (isSaleProblem(products)) return fail(products.message, products.status);

    /**
     * 🔴 `Number(line.quantity)` — the same Decimal trap the DELETE below
     * documents. `SaleItem.quantity` is `Decimal(10,2)` while
     * `ExistingSaleLine.quantity` is a hand-written `number`, and the stock
     * maths adds it to a plain number. A Decimal here would resolve through
     * `valueOf()` to a STRING and silently corrupt every delta.
     */
    const storedLines = existing.items.map((line) => ({
      id: line.id,
      productId: line.productId,
      quantity: Number(line.quantity),
      // The factor this line was SOLD at, so stock reconciles in base units and
      // against the same figure it originally consumed (S8).
      unitFactor: Number(line.unitFactor),
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
    }));

    /**
     * A NEW line may name a selling unit; an existing one keeps what it has.
     * The factor is resolved HERE, from the catalog, and handed to the
     * reconciler — it is never accepted from the request.
     */
    const badUnit = items.find(
      (item) =>
        !item.id &&
        item.unitName &&
        !products.get(item.productId)!.units.some((u) => u.name === item.unitName)
    );
    if (badUnit) {
      const product = products.get(badUnit.productId)!;
      const available = product.units.map((u) => u.name).join(", ") || "none";
      return fail(
        `"${product.name}" has no selling unit called "${badUnit.unitName}". Units on this product: ${available}.`,
        400
      );
    }

    const submitted = items.map((item) => {
      if (item.id) return item;
      const unit = item.unitName
        ? products.get(item.productId)!.units.find((u) => u.name === item.unitName)
        : undefined;
      return {
        ...item,
        unitFactor: unit ? Number(unit.baseFactor) : 1,
        // A new line takes the UNIT's price unless the owner typed one.
        unitPrice: item.unitPrice ?? (unit ? Number(unit.price) : undefined),
      };
    });

    const reconciled = reconcileSaleLines(storedLines, submitted, products);
    if (isSaleProblem(reconciled)) {
      return fail(reconciled.message, reconciled.status);
    }

    const { updates, creates, removedIds, repricedItemIds } = reconciled;

    /**
     * COOLING, RE-APPLIED AFTER RECONCILIATION (Migration E).
     *
     * `reconcileSaleLines` knows nothing about cooling — it computes each line
     * total from the price alone. So the rate is resolved here and the total
     * recomputed with the SAME helper, rather than teaching the shared
     * reconciler a rule only this endpoint has.
     *
     *   EXISTING line -> the STORED rate, always. Cooling is part of what was
     *                    charged; re-opening a bill must not change it, exactly
     *                    as with `unitPrice` (CHECKLIST #7). The edit screen does
     *                    not offer the toggle on a stored line.
     *   NEW line      -> the catalog's charge if `chilled`, else 0.
     */
    const storedRateById = new Map(
      existing.items.map((line) => [line.id, line.coolingRate])
    );
    const zero = new Prisma.Decimal(0);

    const chilledWithoutCharge = items.find(
      (item) => !item.id && item.chilled && !products.get(item.productId)!.coolingCharge
    );
    if (chilledWithoutCharge) {
      const product = products.get(chilledWithoutCharge.productId)!;
      return fail(
        `"${product.name}" has no cooling charge set in the catalog, so it can't be billed as chilled. Set one on the product first.`,
        400
      );
    }

    const withCooling = <T extends { productId: string; quantity: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }>(
      line: T,
      rate: Prisma.Decimal
    ): T & { coolingRate: Prisma.Decimal } => ({
      ...line,
      coolingRate: rate,
      lineTotal: computeLineTotal(line.unitPrice.add(rate), line.quantity),
    });

    const pricedUpdates = updates.map((line) => {
      const stored = existing.items.find((item) => item.id === line.id);
      /**
       * A line whose PRODUCT changed keeps NO cooling. The old product's charge
       * belongs to the old product, the toggle is not offered on an edit, and
       * silently carrying a Pepsi chill charge onto a bun would be worse than
       * dropping it — the owner can see a missing charge, not a stowaway one.
       */
      const rate =
        stored && stored.productId === line.productId
          ? (storedRateById.get(line.id) ?? zero)
          : zero;
      return withCooling(line, rate);
    });

    const pricedCreates = creates.map((line, index) => {
      // `creates` preserves the order of the submitted entries without ids.
      const source = submitted.filter((item) => !item.id)[index];
      const product = products.get(line.productId)!;
      const rate =
        source?.chilled && product.coolingCharge ? product.coolingCharge : zero;
      return withCooling(line, rate);
    });

    // No discounts on this endpoint, so the bill total is simply the sum of the
    // line totals — the same invariant the create path relies on.
    const { total: totalAmount } = computeSaleTotal(
      [...pricedUpdates, ...pricedCreates],
      new Prisma.Decimal(0)
    );
    const tooLarge = checkTotalFits(totalAmount);
    if (tooLarge) return fail(tooLarge.message, tooLarge.status);

    const stockDeltas = computeStockDeltas(storedLines, reconciled);
    const shortfalls = findStockShortfalls(stockDeltas, products);
    if (shortfalls.length > 0) {
      // All-or-nothing, exactly as on create: refused before the transaction
      // opens, so no line moves stock — not even the satisfiable ones.
      return failStockBlocked(stockBlockMessage(shortfalls), shortfalls);
    }

    /** `moduleKey` is re-resolved per line: a product swap may cross shops. */
    const moduleOf = (productId: string) => products.get(productId)!.moduleKey;

    const sale = await prisma.$transaction(
      async (tx) => {
        // Stock first: its conditional update aborts the whole transaction
        // before any line is touched if the numbers moved underneath us.
        await applyStockDeltas(tx, stockDeltas);

        if (removedIds.length > 0) {
          // `saleId` in the filter as well as the ids: a scoped delete can never
          // reach a line on someone else's sale, whatever the payload said.
          await tx.saleItem.deleteMany({
            where: { id: { in: removedIds }, saleId: existing.id },
          });
        }

        for (const update of pricedUpdates) {
          const { id, discountPercent, ...data } = update;
          void discountPercent; // no discounts on this endpoint
          await tx.saleItem.update({
            where: { id },
            data: {
              ...data,
              moduleKey: moduleOf(update.productId),
              netLineTotal: update.lineTotal,
            },
          });
        }

        if (pricedCreates.length > 0) {
          await tx.saleItem.createMany({
            data: pricedCreates.map((line, index) => ({
              saleId: existing.id,
              productId: line.productId,
              moduleKey: moduleOf(line.productId),
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              coolingRate: line.coolingRate,
              unitName:
                submitted.filter((item) => !item.id)[index]?.unitName ?? null,
              unitFactor: line.unitFactor ?? 1,
              lineTotal: line.lineTotal,
              netLineTotal: line.lineTotal,
            })),
          });
        }

        // Last, so the returned select sees the reconciled lines.
        return tx.sale.update({
          where: { id: existing.id },
          data: { ...header, totalAmount },
          select: UNIFIED_SALE_DETAIL_SELECT,
        });
      },
      {
        // One round trip per line update, and a bill may hold 100 of them.
        timeout: 15_000,
        maxWait: 5_000,
      }
    );

    return ok({ ...serialize(sale), repricedItemIds });
  } catch (error) {
    if (error instanceof StockConflictError) {
      return fail(error.message, 409);
    }
    return serverError("sales.[id].PATCH", error);
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
        // `unitFactor` is REQUIRED here, not decoration: a deleted peti line must
        // give back 360 eggs, not 1. Selecting only `quantity` would restore the
        // count of SELLING units and quietly lose the rest of the pool (S8).
        items: {
          select: { id: true, productId: true, quantity: true, unitFactor: true },
        },
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
        // Base units per selling unit, so the restore matches what was taken.
        unitFactor: Number(line.unitFactor),
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
