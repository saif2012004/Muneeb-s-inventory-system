/**
 * THE FARMER STATEMENT AS A REAL SPREADSHEET (.xlsx). Server only.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS INSTEAD OF THE CSV IT REPLACED
 * ---------------------------------------------------------------------------
 * The first version emitted CSV, and the owner's verdict was fair: "no columns
 * spaced properly, no so clear, all the text is same".
 *
 * That is not a formatting bug — it is what CSV IS. A `.csv` is plain text with
 * commas. It carries no font, no weight, no colour, no column width and no
 * number format; Excel renders it in the default 11pt Calibri at whatever width
 * the column happens to be. No amount of care with the CSV could have fixed it.
 *
 * A statement is a document the owner hands to a farmer who may be settling a
 * five- or six-figure balance against it. It has to be READABLE — which means a
 * real workbook: bold headings, sized columns, money right-aligned with
 * thousands separators, and the bottom line visibly the bottom line.
 *
 * ---------------------------------------------------------------------------
 * THE OTHER EXPORTS ARE STILL CSV, DELIBERATELY
 * ---------------------------------------------------------------------------
 * `sales`, `product_sales`, `milk_deliveries` and the rest are row dumps meant
 * to be sorted, filtered and pivoted. CSV is the right shape for those and
 * imports anywhere. Only the STATEMENT is a document, so only the statement is
 * a workbook.
 */
import ExcelJS from "exceljs";

import { formatDate } from "@/lib/format";
import type { FarmerStatement } from "@/lib/milk-statement";
import { getSettings } from "@/lib/settings";

// Design System colours, so the sheet looks like the app it came from.
// ARGB, which is what xlsx wants.
const ZINC_900 = "FF18181B";
const ZINC_600 = "FF52525B";
const ZINC_100 = "FFF4F4F5";
const ZINC_300 = "FFD4D4D8";
const EMERALD = "FF059669"; // milk / money owed to the farmer
const ROSE = "FFE11D48"; // the farmer owes

/** `Rs. 30,000` — no decimals, matching how the SCREEN shows money. */
const MONEY = '"Rs. "#,##0';
/** Litres can be fractional: 12.5 L is an ordinary delivery. */
const LITRES = "#,##0.##";

export async function buildFarmerStatementWorkbook(
  statement: FarmerStatement
): Promise<Buffer> {
  const { farmer, deliveries, purchases, totals, allTimeNetBalance } = statement;

  /**
   * The shop's own name, from Settings — never a literal. Placeholders print
   * VERBATIM here for the same reason they do on a receipt: a statement handed
   * over before setup must be obviously unconfigured, not plausibly real
   * (CHECKLIST #2b).
   */
  const settings = await getSettings();

  const wb = new ExcelJS.Workbook();
  wb.creator = "Business Manager";
  wb.created = new Date();

  const ws = wb.addWorksheet("Statement", {
    // Print setup: a farmer statement gets printed on A4, and without this the
    // six columns spill onto a second sheet of paper.
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
  });

  // Widths sized to the widest real value, not guessed — dates, litres, rate,
  // and money up to seven figures.
  ws.columns = [
    { width: 16 }, // Date / label
    { width: 14 }, // Morning
    { width: 14 }, // Evening
    { width: 14 }, // Total litres
    { width: 16 }, // Rate
    { width: 16 }, // Amount
  ];

  let r = 1;

  // ------------------------------------------------------------------ title
  ws.mergeCells(r, 1, r, 6);
  const title = ws.getCell(r, 1);
  title.value = "FARMER STATEMENT";
  title.font = { name: "Calibri", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZINC_900 } };
  title.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(r).height = 30;
  r += 1;

  ws.mergeCells(r, 1, r, 6);
  const sub = ws.getCell(r, 1);
  sub.value = settings.shopName;
  // Bigger and bold at the owner's request — this is the letterhead, and it is
  // what a farmer looks for first to know whose statement he is holding.
  sub.font = { size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZINC_900 } };
  sub.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 24;
  r += 1;

  ws.mergeCells(r, 1, r, 6);
  const contact = ws.getCell(r, 1);
  contact.value = [settings.shopPhone, settings.shopAddress]
    .filter(Boolean)
    .join("  ·  ");
  contact.font = { size: 10, color: { argb: "FFD4D4D8" } };
  contact.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZINC_900 } };
  contact.alignment = { horizontal: "center" };
  ws.getRow(r).height = 16;
  r += 2;

  // ------------------------------------------------------------------ who / when
  const period =
    statement.period.from && statement.period.to
      ? `${formatDate(statement.period.from)} to ${formatDate(
          new Date(new Date(statement.period.to).getTime() - 1)
        )}`
      : "All time";

  for (const [label, value] of [
    ["Farmer", farmer.name],
    ["Phone", farmer.phone ?? "—"],
    ["Status", farmer.isActive ? "Active" : "Retired"],
    ["Period", period],
    ["Generated", formatDate(new Date())],
  ] as const) {
    const l = ws.getCell(r, 1);
    l.value = label;
    l.font = { bold: true, size: 11, color: { argb: ZINC_600 } };
    ws.mergeCells(r, 2, r, 6);
    const v = ws.getCell(r, 2);
    v.value = value;
    v.font = { size: 11 };
    r += 1;
  }
  r += 1;

  /** A section bar: white bold text on the app's dark surface, full width. */
  function sectionHeading(text: string) {
    ws.mergeCells(r, 1, r, 6);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZINC_900 } };
    c.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(r).height = 24;
    r += 1;
  }

  /** Column headers: bold, tinted, boxed — so the table reads as a table. */
  function tableHeader(labels: string[]) {
    const row = ws.getRow(r);
    labels.forEach((label, i) => {
      const c = row.getCell(i + 1);
      c.value = label;
      c.font = { bold: true, size: 11, color: { argb: ZINC_900 } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZINC_100 } };
      c.alignment = { horizontal: i === 0 ? "left" : "right", vertical: "middle" };
      c.border = {
        top: { style: "thin", color: { argb: ZINC_300 } },
        bottom: { style: "thin", color: { argb: ZINC_300 } },
      };
    });
    row.height = 20;
    r += 1;
  }

  // ------------------------------------------------------------------ deliveries
  sectionHeading("MILK DELIVERED");
  tableHeader(["Date", "Morning (L)", "Evening (L)", "Total Litres", "Rate / Litre", "Amount"]);

  if (deliveries.length === 0) {
    ws.mergeCells(r, 1, r, 6);
    const c = ws.getCell(r, 1);
    c.value = "No deliveries in this period";
    c.font = { italic: true, color: { argb: ZINC_600 } };
    c.alignment = { horizontal: "center" };
    r += 1;
  } else {
    for (const d of deliveries) {
      const row = ws.getRow(r);
      row.getCell(1).value = formatDate(d.date);
      // A session that did not happen shows "—", never 0: a farmer who skipped
      // the morning is not one who turned up empty-handed.
      row.getCell(2).value = d.morningLiters ?? "—";
      row.getCell(3).value = d.eveningLiters ?? "—";
      row.getCell(4).value = d.totalLiters;
      row.getCell(5).value = d.ratePerLiter;
      row.getCell(6).value = d.amount;
      for (let i = 2; i <= 4; i += 1) row.getCell(i).numFmt = LITRES;
      row.getCell(5).numFmt = MONEY;
      row.getCell(6).numFmt = MONEY;
      for (let i = 1; i <= 6; i += 1) {
        row.getCell(i).alignment = { horizontal: i === 1 ? "left" : "right" };
        row.getCell(i).border = { bottom: { style: "hair", color: { argb: ZINC_300 } } };
      }
      r += 1;
    }

    const t = ws.getRow(r);
    t.getCell(1).value = "Total";
    t.getCell(4).value = totals.litres;
    t.getCell(4).numFmt = LITRES;
    t.getCell(6).value = totals.milkValue;
    t.getCell(6).numFmt = MONEY;
    for (let i = 1; i <= 6; i += 1) {
      t.getCell(i).font = { bold: true, size: 11 };
      t.getCell(i).alignment = { horizontal: i === 1 ? "left" : "right" };
      t.getCell(i).border = { top: { style: "thin", color: { argb: ZINC_900 } } };
    }
    r += 1;
  }
  r += 1;

  // ------------------------------------------------------------------ purchases
  sectionHeading("PURCHASES TAKEN");
  tableHeader(["Date", "Item", "", "", "", "Amount"]);
  ws.mergeCells(r - 1, 2, r - 1, 5); // one wide "Item" header

  if (purchases.length === 0) {
    ws.mergeCells(r, 1, r, 6);
    const c = ws.getCell(r, 1);
    c.value = "No purchases in this period";
    c.font = { italic: true, color: { argb: ZINC_600 } };
    c.alignment = { horizontal: "center" };
    r += 1;
  } else {
    for (const p of purchases) {
      const row = ws.getRow(r);
      row.getCell(1).value = formatDate(p.date);
      ws.mergeCells(r, 2, r, 5);
      // "Cash" where money was handed over rather than goods — the owner's rule.
      row.getCell(2).value = p.isCash ? "Cash" : p.item;
      row.getCell(2).alignment = { horizontal: "left" };
      row.getCell(6).value = p.amount;
      row.getCell(6).numFmt = MONEY;
      row.getCell(6).alignment = { horizontal: "right" };
      row.getCell(1).border = { bottom: { style: "hair", color: { argb: ZINC_300 } } };
      row.getCell(6).border = { bottom: { style: "hair", color: { argb: ZINC_300 } } };
      r += 1;
    }

    const t = ws.getRow(r);
    t.getCell(1).value = "Total";
    t.getCell(6).value = totals.purchases;
    t.getCell(6).numFmt = MONEY;
    for (let i = 1; i <= 6; i += 1) {
      t.getCell(i).font = { bold: true, size: 11 };
      t.getCell(i).border = { top: { style: "thin", color: { argb: ZINC_900 } } };
    }
    t.getCell(6).alignment = { horizontal: "right" };
    r += 1;
  }
  r += 1;

  // ------------------------------------------------------------------ summary
  sectionHeading("SUMMARY");

  function summaryRow(label: string, value: number, opts: { strong?: boolean } = {}) {
    ws.mergeCells(r, 1, r, 4);
    const l = ws.getCell(r, 1);
    l.value = label;
    l.font = { bold: Boolean(opts.strong), size: opts.strong ? 12 : 11 };
    ws.mergeCells(r, 5, r, 6);
    const v = ws.getCell(r, 5);
    v.value = value;
    v.numFmt = MONEY;
    v.font = { bold: Boolean(opts.strong), size: opts.strong ? 12 : 11 };
    v.alignment = { horizontal: "right" };
    if (opts.strong) {
      for (const c of [l, v]) {
        c.border = {
          top: { style: "thin", color: { argb: ZINC_900 } },
          bottom: { style: "double", color: { argb: ZINC_900 } },
        };
      }
    }
    ws.getRow(r).height = opts.strong ? 22 : 18;
    r += 1;
  }

  summaryRow("Milk value (this period)", totals.milkValue);
  summaryRow("Purchases (this period)", totals.purchases);
  summaryRow("NET FOR THIS PERIOD", totals.netForPeriod, { strong: true });

  // The direction in words, coloured the way the app colours it: emerald when
  // the owner owes, rose when the farmer does. Positive = the OWNER owes — the
  // sign is inverted versus customers, which is the module's sharpest trap.
  ws.mergeCells(r, 1, r, 6);
  const dir = ws.getCell(r, 1);
  dir.value =
    totals.netForPeriod > 0
      ? "You owe the farmer"
      : totals.netForPeriod < 0
        ? "The farmer owes you"
        : "Settled";
  dir.font = {
    bold: true,
    size: 12,
    color: { argb: totals.netForPeriod < 0 ? ROSE : EMERALD },
  };
  dir.alignment = { horizontal: "right" };
  r += 2;

  /**
   * ⚠️ THE ALL-TIME BALANCE, SET APART AND LABELLED.
   *
   * A period statement is not a running balance. If the range starts partway
   * through a farmer's history these two numbers differ, and a farmer holding
   * the sheet has no way to tell which one he is reading. So it is spelled out
   * rather than left to be inferred.
   */
  ws.mergeCells(r, 1, r, 4);
  const allLabel = ws.getCell(r, 1);
  allLabel.value = "All-time balance (the whole relationship, not just this period)";
  allLabel.font = { size: 11, italic: true, color: { argb: ZINC_600 } };
  ws.mergeCells(r, 5, r, 6);
  const allValue = ws.getCell(r, 5);
  allValue.value = allTimeNetBalance;
  allValue.numFmt = MONEY;
  allValue.font = {
    bold: true,
    size: 11,
    color: { argb: allTimeNetBalance < 0 ? ROSE : EMERALD },
  };
  allValue.alignment = { horizontal: "right" };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
