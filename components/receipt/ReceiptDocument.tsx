import {
  RECEIPT_LINE_CHARS,
  receiptLine,
} from "@/lib/settings-display";
import { formatDate, formatPKR } from "@/lib/format";
import {
  centreLines,
  clampLines,
  divider,
  indent,
  metaRow,
  padRow,
  wrapText,
} from "@/lib/receipt-format";
import { RECEIPT_LINE_CHARS as WIDTH } from "@/lib/settings-display";
import type { ReceiptData } from "@/lib/receipt";

/**
 * The 58mm thermal receipt, built as fixed-width text.
 *
 * ---------------------------------------------------------------------------
 * THE RECEIPT PRINTS PAISE. THE SCREEN ROUNDS. THAT IS DELIBERATE.
 * ---------------------------------------------------------------------------
 * Every amount here uses `formatPKR(value, { precise: true })`, while the
 * on-screen sale detail uses the whole-rupee form. They are the SAME stored
 * numbers shown at different precision, and the difference is not cosmetic:
 *
 *   rounded : 3 × Rs. 276    = Rs. 827     <- does not multiply out
 *   precise : 3 × Rs. 275.50 = Rs. 826.50  <- it does
 *
 * A receipt is the one document a customer checks with a calculator, in front
 * of the owner. A bill whose own arithmetic fails costs him the argument even
 * when his records are right. The screen has no such duty — it is a summary the
 * owner reads, and whole rupees are easier to scan.
 *
 * (Caught in browser verification: the first build printed the rounded form and
 * the fixture receipt read `3 × Rs. 276 ... Rs. 827`.)
 *
 * The date goes through `formatDate`, which is Karachi DD/MM/YYYY. Never
 * `new Date()` here: the sale date is a stored instant and the receipt is a
 * record of it (Gotcha 4).
 */

/** `10` not `10.00`; `12.5` not `12.50`. Percentages read better trimmed. */
function trimPercent(value: number): string {
  return String(Number(value));
}

/** Money as it is printed: two decimals, always. */
function amount(value: number): string {
  return formatPKR(value, { precise: true });
}

/**
 * The same amount without the `Rs. ` prefix, for the unit price inside a
 * quantity row — `2 cottons × 380.00` fits the roll where
 * `2 cottons × Rs. 380.00` does not, and the currency is unambiguous from the
 * total on the same line.
 *
 * Derived from `formatPKR` rather than a second `Intl.NumberFormat`, so digit
 * grouping cannot drift away from the rest of the app.
 */
function bareAmount(value: number): string {
  return amount(value).replace(/^Rs\.\s*/, "");
}

/** `3 cottons` where the unit adds meaning, otherwise just `3`. */
function formatQuantity(quantity: number, unit: string | null): string {
  if (!unit || unit === "piece" || unit === "bottle") return String(quantity);
  return `${quantity} ${unit}${quantity === 1 ? "" : "s"}`;
}

/**
 * Build every line of the receipt.
 *
 * Exported so the layout can be checked as data — the browser verification
 * asserts that no line exceeds the roll width, which is a claim about this
 * function rather than about CSS.
 */
export function buildReceiptLines(receipt: ReceiptData): string[] {
  const { settings } = receipt;
  const lines: string[] = [];

  // -- Header: shop details, centred ---------------------------------------
  // Placeholders print VERBATIM. An unconfigured receipt must be obviously
  // unconfigured (CHECKLIST #2b) — nothing here hides or substitutes them.
  lines.push(...centreLines(settings.shopName));

  const phone = receiptLine(settings.shopPhone);
  if (phone) lines.push(...centreLines(phone));

  const address = receiptLine(settings.shopAddress);
  if (address) lines.push(...centreLines(address));

  lines.push(divider());

  // -- Sale meta ------------------------------------------------------------
  lines.push(...metaRow("Date", formatDate(receipt.saleDate)));
  // The tail of the cuid: short enough to read back over the phone, and unique
  // in practice for a single shop's history.
  lines.push(...metaRow("Sale", receipt.saleId.slice(-8).toUpperCase()));
  // metaRow, not padRow: a long customer name must push itself onto the next
  // line rather than clip the word "Customer" off the front of the row.
  lines.push(...metaRow("Customer", receipt.customerName));

  lines.push(divider());

  // -- Line items -----------------------------------------------------------
  for (const line of receipt.lines) {
    // Name on its own line(s), full width, so long names wrap instead of
    // squeezing the money column.
    lines.push(...wrapText(line.name));

    // Indent AFTER wrapping — wrapText trims, so a leading pair of spaces baked
    // into the input would be eaten and the detail would read as another
    // product name.
    if (line.detail) {
      lines.push(...indent(wrapText(line.detail, WIDTH - 2)));
    }

    // The per-line discount, ONLY when there is one.
    if (line.discountPercent > 0) {
      lines.push(`  ${trimPercent(line.discountPercent)}% off`);
    }

    lines.push(
      padRow(
        `  ${formatQuantity(line.quantity, line.unit)} × ${bareAmount(line.unitPrice)}`,
        amount(line.lineTotal)
      )
    );
  }

  lines.push(divider());

  // -- Totals ---------------------------------------------------------------
  lines.push(padRow("Subtotal", amount(receipt.subtotal)));

  if (receipt.discountPercent > 0) {
    // The saving, shown as the gap between the lines and the stored total —
    // exactly how the on-screen detail presents it, and never recomputed from
    // the percentage.
    const saving = receipt.subtotal - receipt.totalAmount;
    lines.push(
      padRow(
        `Discount (${trimPercent(receipt.discountPercent)}%)`,
        `-${amount(saving)}`
      )
    );
  }

  lines.push(padRow("TOTAL", amount(receipt.totalAmount)));
  lines.push(divider("="));

  // -- Footer ---------------------------------------------------------------
  lines.push(...centreLines("Thank you"));

  return clampLines(lines);
}

export function ReceiptDocument({ receipt }: { receipt: ReceiptData }) {
  const text = buildReceiptLines(receipt).join("\n");

  return (
    // `receipt-paper` sizes the roll and is the ONLY thing @media print keeps.
    <pre className="receipt-paper" data-line-chars={RECEIPT_LINE_CHARS}>
      {text}
    </pre>
  );
}
