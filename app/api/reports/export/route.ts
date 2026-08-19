import { NextResponse } from "next/server";

import { fail, requireOwner, serverError } from "@/lib/api";
import {
  csvAttachmentHeader,
  toCsv,
  toSectionedCsv,
  type CsvValue,
} from "@/lib/csv";
import { endOfKarachiDay, formatDate, startOfKarachiDay } from "@/lib/format";
import { getFarmerBalances } from "@/lib/milk";
import { getFarmerStatement } from "@/lib/milk-statement";
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

/**
 * ⚠️ THREE EXPORT TYPES WERE REMOVED IN S9: `beverages_sales`, `bakery_sales`
 * and `milk_sales`. Their tables no longer exist, and every bill they used to
 * dump — including the two real ones — is in `sales`, which reports the same
 * columns plus the shops each bill drew from.
 *
 * An unknown `type` already returns a 400 listing the valid ones, so a stale
 * bookmark or a saved URL gets a readable message rather than an empty file.
 */
const EXPORT_TYPES = [
  "milk_deliveries",
  "milk_purchases",
  "farmer_balances",
  "customer_balances",
  /**
   * `sales` is the bill — one row per bill, with the shops it drew from.
   * `product_sales` is the owner's #20: every product's units and revenue, with
   * **milk as its own line** because the rows carry `moduleKey`.
   */
  "sales",
  "product_sales",
  /**
   * ONE FARMER, ONE DATE RANGE — the statement the owner hands to a farmer.
   *
   * Unlike every other type here it REQUIRES `farmerId`, and unlike the row
   * dumps it renders its own sectioned document rather than one flat table.
   */
  "farmer_statement",
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
    // Only `farmer_statement` reads this; every other type ignores it.
    const farmerId = searchParams.get("farmerId")?.trim() || undefined;

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

    const result = await buildExport(type, window, farmerId);

    // A builder can refuse — a statement with no farmer chosen, or a farmer that
    // no longer exists. Those are 400/404 in the { data, error } envelope, NOT a
    // CSV: `useExportCSV` checks the content type before saving, so an error
    // written as a file would land on disk as a .csv full of JSON.
    if ("error" in result) return fail(result.error, result.status);

    const stamp = new Date().toISOString().slice(0, 10);
    const csv = "csv" in result ? result.csv : toCsv(result.headers, result.rows);
    const filename =
      "filename" in result ? result.filename : `${type}_${stamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": csvAttachmentHeader(filename),
        // An export is a point-in-time snapshot; never let one be reused.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return serverError("reports.export.GET", error);
  }
}

/**
 * What a builder produces.
 *
 * Most exports are a single table and return `{ headers, rows }`. The farmer
 * statement renders its own multi-section document, so it returns a finished
 * `csv` string plus the filename it wants — the generic `type_date.csv` would
 * lose the one thing that identifies it, which farmer it is for.
 */
type ExportResult =
  | { headers: string[]; rows: CsvValue[][] }
  | { csv: string; filename: string };

async function buildExport(
  type: ExportType,
  window: { gte: Date; lt: Date } | undefined,
  farmerId: string | undefined
): Promise<ExportResult | { error: string; status: number }> {
  switch (type) {
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

      // The extra query that used to run here excluded bills that were copies of
      // an old per-module row, so that two export types could not report the
      // same sale twice. Both the copies and the other types went in S9.
      return {
        headers: ["Date", "Customer", "Customer Type", "Shops", "Items", "Total", "Notes"],
        rows: sales.map((s) => [
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

    /**
     * THE FARMER STATEMENT. Deliveries and purchases for one farmer over one
     * date range, sorted by date, with the totals the owner asked for.
     */
    case "farmer_statement": {
      if (!farmerId) {
        return { error: "Choose a farmer for the statement.", status: 400 };
      }
      const statement = await getFarmerStatement(farmerId, window);
      if (!statement) {
        return { error: "That farmer no longer exists.", status: 404 };
      }

      const { farmer, deliveries, purchases, totals } = statement;
      const period =
        window && statement.period.from && statement.period.to
          ? `${formatDate(statement.period.from)} to ${formatDate(
              new Date(window.lt.getTime() - 1)
            )}`
          : "All time";

      const csv = toSectionedCsv([
        {
          title: "Farmer statement",
          rows: [
            ["Farmer", farmer.name],
            ["Phone", farmer.phone],
            ["Status", farmer.isActive ? "Active" : "Retired"],
            ["Period", period],
            ["Generated", formatDate(new Date())],
          ],
        },
        {
          title: "Milk delivered",
          headers: [
            "Date",
            "Morning (L)",
            "Evening (L)",
            "Total Litres",
            "Rate Per Litre",
            "Amount",
          ],
          rows: [
            ...deliveries.map((d) => [
              formatDate(d.date),
              // A session that did not happen prints blank, never 0 — see the
              // note on StatementDelivery.
              d.morningLiters,
              d.eveningLiters,
              d.totalLiters,
              d.ratePerLiter,
              d.amount,
            ]),
            deliveries.length === 0
              ? ["No deliveries in this period", null, null, null, null, null]
              : ["Total", null, null, totals.litres, null, totals.milkValue],
          ],
        },
        {
          title: "Purchases",
          headers: ["Date", "Item", "Amount"],
          rows: [
            ...purchases.map((p) => [
              formatDate(p.date),
              // "Cash" when money was handed over rather than goods — the
              // owner's instruction. His own wording is kept otherwise.
              p.isCash ? "Cash" : p.item,
              p.amount,
            ]),
            purchases.length === 0
              ? ["No purchases in this period", null, null]
              : ["Total", null, totals.purchases],
          ],
        },
        {
          title: "Summary",
          rows: [
            ["Milk value (this period)", totals.milkValue],
            ["Purchases (this period)", totals.purchases],
            ["Net for this period", totals.netForPeriod],
            [
              "Direction",
              totals.netForPeriod > 0
                ? "You owe the farmer"
                : totals.netForPeriod < 0
                  ? "The farmer owes you"
                  : "Settled",
            ],
            [],
            /**
             * BOTH figures, labelled. The period net is not the balance — if the
             * range starts partway through the relationship they can differ by
             * any amount, and a farmer reading one number has no way to tell
             * which he is holding.
             */
            ["All-time balance (not just this period)", statement.allTimeNetBalance],
            [
              "All-time direction",
              statement.allTimeNetBalance > 0
                ? "You owe the farmer"
                : statement.allTimeNetBalance < 0
                  ? "The farmer owes you"
                  : "Settled",
            ],
          ],
        },
      ]);

      const stamp = new Date().toISOString().slice(0, 10);
      return { csv, filename: `statement_${farmer.name}_${stamp}.csv` };
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
