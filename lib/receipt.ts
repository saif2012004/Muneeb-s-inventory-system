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
 * WHICH TABLE THIS READS, AND WHY IT IS NOT `Sale`
 * ---------------------------------------------------------------------------
 * It reads `BeverageSale` / `BakerySale` — the tables the app actually runs on.
 * The unified `Sale`/`SaleItem` pair exists (migration A) but NOTHING reads or
 * writes it yet, there is no way to create one, and no screen lists them
 * (CHECKLIST #4). A receipt pointed at that table would have no reachable sale
 * to print.
 *
 * `loadReceipt` is therefore the ONLY thing that will need to change when the
 * unified sale ships: everything downstream consumes `ReceiptData`, which is
 * already shaped like a unified sale. `netLineTotal` — a line's share after the
 * whole-bill discount — has no column on the per-module tables, so it is absent
 * here rather than invented; when `SaleItem` becomes live, add it to the line
 * type and print it beside `lineTotal`.
 *
 * QUERY BUDGET: 2 round trips (~2.2s at the current region split, CHECKLIST #14)
 * — the sale, then the settings row. Awaited in SERIES, never Promise.all: the
 * pooled connection limit is 1, so parallel calls only queue.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { SALE_DETAIL_SELECT } from "@/lib/sales";
import { getSettings } from "@/lib/settings";
import type { Settings } from "@/lib/settings-display";
import { serializeMoney } from "@/lib/serialize";

/** Which module's sale table to read. Mirrors the `/api/{module}/sales` split. */
export type ReceiptModuleKey = "beverages" | "bakery";

export function isReceiptModuleKey(value: string): value is ReceiptModuleKey {
  return value === "beverages" || value === "bakery";
}

export type ReceiptLine = {
  id: string;
  name: string;
  /** Size / tier / shape, already composed — the same detail the screen shows. */
  detail: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
};

export type ReceiptData = {
  moduleKey: ReceiptModuleKey;
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

const MODULE_LABEL: Record<ReceiptModuleKey, string> = {
  beverages: "Beverages",
  bakery: "Bakery",
};

/** The size/tier/shape suffix, composed exactly as the sale detail composes it. */
function composeDetail(product: {
  size: string | null;
  qualityTier: string | null;
  shape: string | null;
}): string | null {
  const parts = [product.size, product.qualityTier, product.shape]
    .filter((part): part is string => Boolean(part))
    .map((part) =>
      part
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    );
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Load one sale, ready to print. `null` when the sale does not exist.
 *
 * NOTE ON THE HEADER: settings values are returned verbatim, placeholders and
 * all. An unconfigured shop must print `SET SHOP NAME IN SETTINGS` on the roll —
 * hiding it or substituting something friendly would produce a receipt that
 * looks finished and is wrong, which is the whole reason the placeholders shout
 * (CHECKLIST #2b).
 */
export async function loadReceipt(
  moduleKey: ReceiptModuleKey,
  saleId: string
): Promise<ReceiptData | null> {
  const sale =
    moduleKey === "beverages"
      ? await prisma.beverageSale.findUnique({
          where: { id: saleId },
          select: SALE_DETAIL_SELECT,
        })
      : await prisma.bakerySale.findUnique({
          where: { id: saleId },
          select: SALE_DETAIL_SELECT,
        });

  if (!sale) return null;

  // Sum in Decimal, then serialize once — never add money as JS numbers.
  const subtotal = sale.items.reduce(
    (total, item) => total.add(item.lineTotal),
    new Prisma.Decimal(0)
  );

  // Second round trip. In series, deliberately (connection_limit=1).
  const settings = await getSettings();

  // Field-by-field rather than the deep `serialize()`: that helper leaves Date
  // objects as Dates by design, and this crosses into a client boundary where
  // the date has to be an ISO string.
  return {
    moduleKey,
    moduleLabel: MODULE_LABEL[moduleKey],
    saleId: sale.id,
    saleDate: sale.saleDate.toISOString(),
    customerName: sale.customer.name,
    lines: sale.items.map((item) => ({
      id: item.id,
      name: item.product.name,
      detail: composeDetail(item.product),
      unit: item.product.unit,
      quantity: item.quantity,
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
