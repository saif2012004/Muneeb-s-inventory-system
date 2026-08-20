/**
 * THE RECEIPT DATA LOADER. Server only — imports Prisma.
 *
 * ---------------------------------------------------------------------------
 * READ-ONLY, AND EVERY FIGURE IS A STORED ONE
 * ---------------------------------------------------------------------------
 * The receipt is a printout OF THE RECORD. It must show what was charged, so it
 * reads the stored snapshot and nothing else:
 *
 *   - `unitPrice`       — the line's own snapshot, never `Product.price`
 *   - `discountPercent` — per line AND whole-bill, both as actually applied
 *   - `lineTotal`       — stored
 *   - `totalAmount`     — stored; the receipt NEVER recomputes the total
 *
 * The single derived number is the SUBTOTAL, which is the sum of the stored line
 * totals. It is derived here, server-side, in `Prisma.Decimal` (never in the
 * browser — Gotcha 2), and only so the whole-bill discount row has something to
 * be a discount FROM. It is exactly the same derivation the on-screen sale
 * detail does in `components/sales/SaleLineItems.tsx`, deliberately, because the
 * printed bill and the screen must agree to the rupee.
 *
 * ---------------------------------------------------------------------------
 * ONE SOURCE: `Sale` / `SaleItem`
 * ---------------------------------------------------------------------------
 * There were two loaders until S9 — one per old module table, one unified — both
 * producing the same `ReceiptData` for the same renderer. That shape was chosen
 * ahead of time to be the unified sale's, which is why retiring the per-module
 * half touched nothing downstream.
 *
 * QUERY BUDGET: 2 round trips (~2.2s at the current region split, CHECKLIST #14)
 * — the sale, then the settings row. Awaited in SERIES, never Promise.all: the
 * pooled connection limit is 1, so parallel calls only queue.
 */
import { Prisma } from "@prisma/client";

import { composeProductDetail } from "@/lib/catalog-display";
import { prisma } from "@/lib/prisma";
import { UNIFIED_SALE_DETAIL_SELECT } from "@/lib/unified-sales";
import { getSettings } from "@/lib/settings";
import type { Settings } from "@/lib/settings-display";
import { serializeMoney } from "@/lib/serialize";

/**
 * What a receipt was printed FROM. Only `"sale"` since S9 — one bill table, and
 * a bill can hold lines from all three shops at once.
 *
 * Kept as a union of one rather than deleted: `ReceiptData.moduleKey` is read by
 * the renderer and by the print page, and collapsing it to a bare string would
 * lose the guarantee that only a known value reaches them.
 */
export type ReceiptSourceKey = "sale";

export type ReceiptLine = {
  id: string;
  name: string;
  /** Cooling charge per unit actually applied. 0 = not chilled. */
  coolingRate?: number;
  /**
   * The SELLING UNIT this line was sold in (Migration F) — "peti", "tray", … or
   * null for the base unit. SNAPSHOTTED on the line, so a printed bill keeps
   * saying "2 peti" even if the catalog later renames or deletes that unit.
   */
  unitName?: string | null;
  /** Size / tier / shape, already composed — the same detail the screen shows. */
  detail: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
};

export type ReceiptData = {
  moduleKey: ReceiptSourceKey;
  moduleLabel: string;
  saleId: string;
  /** ISO-8601 UTC. Format with `formatDate` — Karachi, DD/MM/YYYY (Gotcha 4). */
  saleDate: string;
  customerName: string;
  lines: ReceiptLine[];
  /** Sum of the stored line totals. Derived server-side; see the note above. */
  subtotal: number;
  discountPercent: number;
  /** Stored. The authority for what the bill came to. */
  totalAmount: number;
  notes: string | null;
  /** The shop header. Placeholders are passed through UNCHANGED — see below. */
  settings: Settings;
};

/**
 * Load one UNIFIED sale, ready to print (S4.2).
 *
 * ---------------------------------------------------------------------------
 * ONE FLAT LIST, ONE TOTAL — the owner's decision, 2026-08-14
 * ---------------------------------------------------------------------------
 * A mixed bill prints its lines in the order they were rung up, with a single
 * TOTAL and **no per-category subtotals**. That is a deliberate answer to a
 * question that was asked (Q1), not an omission: grouping would add ~2 printed
 * lines per shop present and would reorder the bill away from how it was typed.
 * Per-product visibility is a REPORTING need and is answered on screen in S6,
 * not on the customer's receipt.
 *
 * `ReceiptDocument` needs no change for any of this — `ReceiptData` was already
 * shaped like a unified sale (see the note at the top of this file), so the same
 * renderer prints both. The unified endpoint has no discounts, so
 * `discountPercent` is 0 and the discount rows simply do not render; subtotal
 * therefore equals the stored total, and the subtotal is still DERIVED here in
 * Decimal rather than in the browser.
 *
 * `netLineTotal` is deliberately NOT printed. With no discount it is equal to
 * `lineTotal` to the paise, so printing both would be two identical columns on a
 * roll where every character is budgeted.
 *
 * QUERY BUDGET: 2 round trips — the sale, then the settings row — awaited in
 * SERIES, never Promise.all (connection_limit=1).
 */
export async function loadUnifiedReceipt(
  saleId: string
): Promise<ReceiptData | null> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: UNIFIED_SALE_DETAIL_SELECT,
  });
  if (!sale) return null;

  // Sum in Decimal, then serialize once — never add money as JS numbers.
  const subtotal = sale.items.reduce(
    (total, item) => total.add(item.lineTotal),
    new Prisma.Decimal(0)
  );

  const settings = await getSettings();

  return {
    moduleKey: "sale",
    // Not "Beverages"/"Bakery": this bill may be all three, so it names itself
    // by what it IS rather than by a shop it might not belong to.
    moduleLabel: "Sale",
    saleId: sale.id,
    saleDate: sale.saleDate.toISOString(),
    customerName: sale.customer.name,
    lines: sale.items.map((item) => ({
      id: item.id,
      name: item.product.name,
      detail: composeProductDetail(item.product),
      unit: item.product.unit,
      coolingRate: serializeMoney(item.coolingRate),
      unitName: item.unitName,
      // `quantity` is Decimal(10,2) on this table (Migration C) — `Number()` it
      // here, at the boundary, or `12.5` prints as an object (Gotcha 2).
      quantity: Number(item.quantity),
      unitPrice: serializeMoney(item.unitPrice),
      discountPercent: serializeMoney(item.discountPercent),
      lineTotal: serializeMoney(item.lineTotal),
    })),
    subtotal: serializeMoney(subtotal),
    discountPercent: serializeMoney(sale.discountPercent),
    totalAmount: serializeMoney(sale.totalAmount),
    notes: sale.notes,
    settings,
  };
}
