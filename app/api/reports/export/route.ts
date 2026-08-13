import { NextResponse } from "next/server";

import { fail, requireOwner, serverError } from "@/lib/api";
import { csvAttachmentHeader, toCsv, type CsvValue } from "@/lib/csv";
import { endOfKarachiDay, formatDate, startOfKarachiDay } from "@/lib/format";
import { getFarmerBalances } from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { getCustomerBalances, unifiedSaleModules } from "@/lib/receivables";
import { getProductSales } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shop names for the unified exports. */
const MODULE_WORDS: Record<string, string> = {
  beverages: "Beverages",
  bakery: "Bakery",
  milk: "Milk",
};

/**
 * GET /api/reports/export?type=…&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *
 * ---------------------------------------------------------------------------
 * THIS ROUTE DELIBERATELY DOES NOT RETURN THE { data, error } ENVELOPE
 * ---------------------------------------------------------------------------
 * A success is a CSV file with `Content-Type: text/csv` and a download
 * disposition — wrapping it in JSON would defeat the point. FAILURES still use
 * the envelope, so the client can surface a real message; the export hook
 * checks the content type before treating a response as a file.
 *
 * ---------------------------------------------------------------------------
 * FORMATTING RULES (this is for spreadsheets, not for reading)
 * ---------------------------------------------------------------------------
 *   - Money is a PLAIN NUMBER: 1250, never "Rs. 1,250". A formatted string
 *     cannot be summed, and summing is the entire reason to export.
 *   - Dates are DD/MM/YYYY in Asia/Karachi, matching the Design System and what
 *     the owner sees on screen.
 *   - Commas, quotes and newlines inside names and notes are quoted per
 *     RFC 4180 by lib/csv.ts — a customer called `Ali, Sons` must not shift
 *     every column after it.
 */

const EXPORT_TYPES = [
  "beverages_sales",
  "bakery_sales",
  "milk_deliveries",
  "milk_purchases",
  "milk_sales",
  "farmer_balances",
  "customer_balances",
  /**
   * S6. `sales` is the UNIFIED bill — one row per bill, with the shops it drew
   * from. `product_sales` is the owner's #20: every product's units and revenue,
   * with **milk as its own line** because the rows carry `moduleKey`.
   *
   * The per-module sale exports above are deliberately kept: they still hold
   * real history until S5 folds it in, and an export that silently stopped
   * covering it would be worse than two files.
   */
  "sales",
  "product_sales",
] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

/**
 * Balance exports are a snapshot of what is owed RIGHT NOW, so a date range
 * does not apply to them — silently filtering a balance by date would produce a
 * number that looks authoritative and isn't.
 */
const IGNORES_DATE_RANGE: ReadonlySet<ExportType> = new Set<ExportType>([
  "farmer_balances",
  "customer_balances",
]);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Decimal -> plain number for a spreadsheet cell. */
function num(value: { toNumber: () => number } | null | undefined): number {
  return value ? Number(value.toNumber().toFixed(2)) : 0;
}

/** Nullable Decimal -> number or blank, preserving "didn't happen" vs "zero". */
function optionalNum(
  value: { toNumber: () => number } | null | undefined
): CsvValue {
  return value === null || value === undefined
    ? null
    : Number(value.toNumber().toFixed(2));
}

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as ExportType | null;

    if (!type || !EXPORT_TYPES.includes(type)) {
      return fail(
        `Unknown export type. Use one of: ${EXPORT_TYPES.join(", ")}.`,
        400
      );
    }

    const dateFrom = searchParams.get("dateFrom")?.trim();
    const dateTo = searchParams.get("dateTo")?.trim();

    let window: { gte: Date; lt: Date } | undefined;
    if (!IGNORES_DATE_RANGE.has(type) && (dateFrom || dateTo)) {
      if (!dateFrom || !dateTo) {
        return fail("Give both dateFrom and dateTo, or neither.", 400);
      }
      if (!DATE_ONLY.test(dateFrom) || !DATE_ONLY.test(dateTo)) {
        return fail("Dates must be YYYY-MM-DD.", 400);
      }
      const gte = startOfKarachiDay(dateFrom);
      const lt = endOfKarachiDay(dateTo);
      if (gte >= lt) {
        return fail("The start date must be on or before the end date.", 400);
      }
      window = { gte, lt };
    }

    const { headers, rows } = await buildExport(type, window);
    const csv = toCsv(headers, rows);

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": csvAttachmentHeader(`${type}_${stamp}.csv`),
        // An export is a point-in-time snapshot; never let one be reused.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return serverError("reports.export.GET", error);
  }
}

async function buildExport(
  type: ExportType,
  window: { gte: Date; lt: Date } | undefined
): Promise<{ headers: string[]; rows: CsvValue[][] }> {
  switch (type) {
    case "beverages_sales": {
      const sales = await prisma.beverageSale.findMany({
        where: window ? { saleDate: window } : {},
        select: {
          saleDate: true,
          totalAmount: true,
          notes: true,
          customer: { select: { name: true, type: true } },
          _count: { select: { items: true } },
        },
        orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
      });
      return {
        headers: ["Date", "Customer", "Customer Type", "Items", "Total", "Notes"],
        rows: sales.map((s) => [
          formatDate(s.saleDate),
          s.customer.name,
          s.customer.type,
          s._count.items,
          num(s.totalAmount),
          s.notes,
        ]),
      };
    }

    case "bakery_sales": {
      const sales = await prisma.bakerySale.findMany({
        where: window ? { saleDate: window } : {},
        select: {
          saleDate: true,
          totalAmount: true,
          notes: true,
          customer: { select: { name: true, type: true } },
          _count: { select: { items: true } },
        },
        orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
      });
      return {
        headers: ["Date", "Customer", "Customer Type", "Items", "Total", "Notes"],
        rows: sales.map((s) => [
          formatDate(s.saleDate),
          s.customer.name,
          s.customer.type,
          s._count.items,
          num(s.totalAmount),
          s.notes,
        ]),
      };
    }

    case "milk_deliveries": {
      const deliveries = await prisma.milkDelivery.findMany({
        where: window ? { deliveryDate: window } : {},
        select: {
          deliveryDate: true,
          morningLiters: true,
          eveningLiters: true,
          ratePerLiter: true,
          totalLiters: true,
          totalAmount: true,
          notes: true,
          farmer: { select: { name: true } },
        },
        orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
      });
      return {
        headers: [
          "Date",
          "Farmer",
          "Morning Liters",
          "Evening Liters",
          "Total Liters",
          "Rate Per Liter",
          "Amount",
          "Notes",
        ],
        rows: deliveries.map((d) => [
          formatDate(d.deliveryDate),
          d.farmer.name,
          // Blank, not 0 — a session that did not happen is not a delivery of
          // nothing, and a spreadsheet average would be wrong if we wrote 0.
          optionalNum(d.morningLiters),
          optionalNum(d.eveningLiters),
          num(d.totalLiters),
          num(d.ratePerLiter),
          num(d.totalAmount),
          d.notes,
        ]),
      };
    }

    case "milk_purchases": {
      const purchases = await prisma.farmerPurchase.findMany({
        where: window ? { purchaseDate: window } : {},
        select: {
          purchaseDate: true,
          itemDescription: true,
          amount: true,
          notes: true,
          farmer: { select: { name: true } },
        },
        orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
      });
      return {
        headers: ["Date", "Farmer", "Item", "Amount", "Notes"],
        rows: purchases.map((p) => [
          formatDate(p.purchaseDate),
          p.farmer.name,
          p.itemDescription,
          num(p.amount),
          p.notes,
        ]),
      };
    }

    /**
     * The UNIFIED bill. One row per bill, with the shops it drew from — a mixed
     * bill is ONE line reading "Beverages · Milk", not one line per shop, so the
     * Total column can be summed in a spreadsheet without double-counting.
     */
    case "sales": {
      const sales = await prisma.sale.findMany({
        where: window ? { saleDate: window } : {},
        select: {
          id: true,
          saleDate: true,
          totalAmount: true,
          notes: true,
          customer: { select: { name: true, type: true } },
          _count: { select: { items: true } },
          items: { select: { moduleKey: true } },
        },
        orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
      });

      // A migrated copy carries the id of the old row it came from, and that row
      // is already exported by its own per-module type. Excluding it here is the
      // same rule lib/receivables.ts and lib/reports.ts apply through
      // NOT_A_MIGRATION_COPY — otherwise two files together report one sale
      // twice. `MilkSale` is included ahead of S5 copying it, for the reason
      // given on that constant.
      const legacy = await prisma.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM "Sale" s
        WHERE EXISTS (SELECT 1 FROM "BeverageSale" b WHERE b.id = s.id)
           OR EXISTS (SELECT 1 FROM "BakerySale" k WHERE k.id = s.id)
           OR EXISTS (SELECT 1 FROM "MilkSale" m WHERE m.id = s.id)
      `;
      const legacyIds = new Set(legacy.map((row) => row.id));

      return {
        headers: ["Date", "Customer", "Customer Type", "Shops", "Items", "Total", "Notes"],
        rows: sales
          .filter((s) => !legacyIds.has(s.id))
          .map((s) => [
            formatDate(s.saleDate),
            s.customer.name,
            s.customer.type,
            unifiedSaleModules(s.items)
              .map((key) => MODULE_WORDS[key] ?? key)
              .join(" · "),
            s._count.items,
            num(s.totalAmount),
            s.notes,
          ]),
      };
    }

    /**
     * PER-PRODUCT SALES (#20) — how much of each product actually sold, across
     * all three shops, with milk on its own line because the rows carry the
     * snapshotted `moduleKey`.
     *
     * Unlike every other export here this one is AGGREGATED rather than a row
     * dump, which is the point: the owner asked "how many eggs / buns / litres",
     * not for a list of bills to add up himself.
     */
    case "product_sales": {
      const rows = await getProductSales({
        // No window = everything ever. `karachiRange` is not used: the caller's
        // dateFrom/dateTo already arrive as Karachi day boundaries.
        start: window?.gte ?? new Date(0),
        end: window?.lt ?? new Date("2999-12-31T00:00:00.000Z"),
      });
      return {
        headers: ["Product", "Shop", "Unit", "Quantity Sold", "Revenue"],
        rows: rows.map((row) => [
          row.productName,
          MODULE_WORDS[row.moduleKey] ?? row.moduleKey,
          row.unit,
          row.quantity,
          row.revenue,
        ]),
      };
    }

    case "milk_sales": {
      const sales = await prisma.milkSale.findMany({
        where: window ? { saleDate: window } : {},
        select: {
          saleDate: true,
          liters: true,
          ratePerLiter: true,
          totalAmount: true,
          notes: true,
          customer: { select: { name: true, type: true } },
        },
        orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
      });
      return {
        headers: [
          "Date",
          "Customer",
          "Customer Type",
          "Liters",
          "Rate Per Liter",
          "Total",
          "Notes",
        ],
        rows: sales.map((s) => [
          formatDate(s.saleDate),
          s.customer.name,
          s.customer.type,
          num(s.liters),
          num(s.ratePerLiter),
          num(s.totalAmount),
          s.notes,
        ]),
      };
    }

    case "farmer_balances": {
      // Every farmer, retired included — retiring someone does not settle what
      // they are owed, and an export of balances that omitted them would be a
      // payables list with a hole in it.
      const farmers = await prisma.farmer.findMany({
        select: { id: true, name: true, phone: true, isActive: true },
        orderBy: { name: "asc" },
      });
      const balances = await getFarmerBalances(farmers.map((f) => f.id));

      return {
        headers: [
          "Farmer",
          "Phone",
          "Status",
          "Total Liters",
          "Milk Value",
          "Purchases",
          "Net Balance",
          "Direction",
          "Last Delivery",
          "Last Purchase",
        ],
        rows: farmers.map((f) => {
          const b = balances.get(f.id)!;
          const net = num(b.netBalanceOwed);
          return [
            f.name,
            f.phone,
            f.isActive ? "Active" : "Retired",
            num(b.totalLiters),
            num(b.totalMilkValue),
            num(b.totalPurchases),
            net,
            // The sign alone is ambiguous in a spreadsheet, and it is the
            // opposite of the customer convention. Spell it out.
            net > 0 ? "You owe farmer" : net < 0 ? "Farmer ahead" : "Settled",
            b.lastDeliveryDate ? formatDate(b.lastDeliveryDate) : null,
            b.lastPurchaseDate ? formatDate(b.lastPurchaseDate) : null,
          ];
        }),
      };
    }

    case "customer_balances": {
      // Deactivated customers included for the same reason as retired farmers:
      // deactivating does not settle a bill.
      const customers = await prisma.customer.findMany({
        select: { id: true, name: true, phone: true, type: true, isActive: true },
        orderBy: { name: "asc" },
      });
      const balances = await getCustomerBalances(customers.map((c) => c.id));

      return {
        headers: [
          "Customer",
          "Phone",
          "Type",
          "Status",
          "Total Billed",
          "Total Paid",
          "Outstanding",
          "Direction",
          "Last Sale",
          "Last Payment",
        ],
        rows: customers.map((c) => {
          const b = balances.get(c.id)!;
          const outstanding = num(b.outstanding);
          return [
            c.name,
            c.phone,
            c.type,
            c.isActive ? "Active" : "Inactive",
            num(b.totalBilled),
            num(b.totalPaid),
            outstanding,
            outstanding > 0
              ? "Customer owes"
              : outstanding < 0
                ? "In credit"
                : "Settled",
            b.lastSaleDate ? formatDate(b.lastSaleDate) : null,
            b.lastPaymentDate ? formatDate(b.lastPaymentDate) : null,
          ];
        }),
      };
    }
  }
}
