import { RECEIPT_LINE_CHARS, receiptLine } from "@/lib/settings-display";
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
import type { ReceiptData } from "@/lib/receipt";

/**
 * The thermal receipt, built as fixed-width text.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LIVES IN `lib/` AND NOT IN `ReceiptDocument.tsx`
 * ---------------------------------------------------------------------------
 * It used to be exported from the component file. The USB print path needs it
 * in a CLIENT bundle, and importing it from `ReceiptDocument.tsx` would drag the
 * React component — and everything it imports — along with it. Same hygiene as
 * the split CLAUDE.md recommends for `lib/reports.ts`: the client-safe text
 * builder is its own module, and nothing here touches Prisma, the DOM or JSX.
 *
 * ---------------------------------------------------------------------------
 * WIDTH IS A PARAMETER. THE TWO PRINT PATHS USE DIFFERENT VALUES, DELIBERATELY.
 * ---------------------------------------------------------------------------
 *   browser `window.print()` -> 32  (RECEIPT_LINE_CHARS, the default here)
 *   native ESC/POS over USB  -> 48  (ESCPOS_LINE_CHARS, see lib/escpos.ts)
 *
 * That is not an inconsistency to tidy up. The browser rasterises a web font and
 * at 48 columns the owner could not read it (2026-08-22); the printer's OWN
 * Font A is 12x24 dots — 1.5 x 3.0mm — and he reads it fine at 48. Same paper,
 * same head, different renderer, different legible density. See the receipt
 * section of CLAUDE.md.
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
 * when his records are right. The screen has no such duty.
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

/**
 * `3 cottons` where the unit adds meaning, otherwise just `3`.
 *
 * ⚠️ LITRES ARE ABBREVIATED TO `L`, and that is not cosmetic — it is what makes
 * a milk line fit the roll. Found by printing a real one:
 *
 *   12.5 litres × 12… Rs. 1,500.00     <- 32 chars, the RATE gets truncated
 *   12.5 L × 120.00   Rs. 1,500.00     <- fits, rate readable
 *
 * A truncated unit price on a customer's bill is exactly the failure the paise
 * rule exists to prevent: the arithmetic stops being checkable. `L` is the
 * standard symbol and no shop owner will misread it. The SCREEN still says
 * "litres" — it has the room.
 */
function formatQuantity(
  quantity: number,
  unit: string | null,
  unitName?: string | null
): string {
  /**
   * A SELLING UNIT wins over the product's base unit (Migration F).
   *
   * `2 peti × 7,000.00` is what the owner sold and what the customer is being
   * charged for; printing `720 eggs` — the base units the stock pool moved by —
   * would be a number that does not multiply out against the peti price, which
   * is the one failure this whole receipt is built to avoid.
   *
   * Printed VERBATIM, unpluralised: these are the owner's own words for a pack
   * ("peti", "tray", "dozen"), and English pluralisation rules do not apply to
   * a Punjabi/Urdu word. `2 petis` would be us correcting his vocabulary on his
   * own receipt.
   */
  if (unitName) return `${quantity} ${unitName}`;
  if (!unit || unit === "piece" || unit === "bottle") return String(quantity);
  if (unit === "litre") return `${quantity} L`;
  // "kg" is a symbol and never takes an "s" — `0.2 kgs` is wrong the way
  // `5 kms` is. Mirrors UNPLURALISED_UNITS in lib/sale-catalog.ts.
  if (unit === "kg") return `${quantity} kg`;
  return `${quantity} ${unit}${quantity === 1 ? "" : "s"}`;
}

/**
 * How many opening lines of the built receipt are the shop name.
 *
 * Both renderers drop these and draw the name themselves at a larger size — see
 * the padding warning on `buildReceiptLines`. Derived rather than hardcoded to
 * 1, so a wrapped name cannot leave half the header behind.
 */
export function shopNameLineCount(
  receipt: ReceiptData,
  width: number = RECEIPT_LINE_CHARS
): number {
  return centreLines(receipt.settings.shopName, width).length;
}

/**
 * Build every line of the receipt.
 *
 * Exported so the layout can be checked as data — the browser verification
 * asserts that no line exceeds the roll width, which is a claim about this
 * function rather than about CSS.
 *
 * ⚠️ RETURNS TEXT ONLY — no markup, no printer commands, no emphasis. Both
 * renderers depend on that: the browser one asserts every line is <= `width`,
 * and the ESC/POS one counts columns to keep the money column aligned. Putting
 * presentation in here makes both checks meaningless.
 *
 * ⚠️ THE OPENING LINES ARE THE SHOP NAME, CENTRED BY PADDING WITH SPACES, and
 * both renderers DROP them (`shopNameLineCount`) and draw the name themselves.
 * Those pad spaces are glyphs: enlarge the name and the padding enlarges with
 * it, shoving the name right and off the paper. In the browser that is a CSS
 * centring on the trimmed string; in ESC/POS it is `ESC a 1` on the trimmed
 * string. Never enlarge a padded line.
 */
export function buildReceiptLines(
  receipt: ReceiptData,
  width: number = RECEIPT_LINE_CHARS
): string[] {
  const { settings } = receipt;
  const lines: string[] = [];

  // -- Header: shop details, centred ---------------------------------------
  // Placeholders print VERBATIM. An unconfigured receipt must be obviously
  // unconfigured (CHECKLIST #2b) — nothing here hides or substitutes them.
  lines.push(...centreLines(settings.shopName, width));

  const phone = receiptLine(settings.shopPhone);
  if (phone) lines.push(...centreLines(phone, width));

  const address = receiptLine(settings.shopAddress);
  if (address) lines.push(...centreLines(address, width));

  lines.push(divider("-", width));

  // -- Sale meta ------------------------------------------------------------
  lines.push(...metaRow("Date", formatDate(receipt.saleDate), width));
  // The tail of the cuid: short enough to read back over the phone, and unique
  // in practice for a single shop's history.
  lines.push(...metaRow("Sale", receipt.saleId.slice(-8).toUpperCase(), width));
  // metaRow, not padRow: a long customer name must push itself onto the next
  // line rather than clip the word "Customer" off the front of the row.
  lines.push(...metaRow("Customer", receipt.customerName, width));

  lines.push(divider("-", width));

  // -- Line items -----------------------------------------------------------
  for (const line of receipt.lines) {
    // Name on its own line(s), full width, so long names wrap instead of
    // squeezing the money column.
    lines.push(...wrapText(line.name, width));

    // Indent AFTER wrapping — wrapText trims, so a leading pair of spaces baked
    // into the input would be eaten and the detail would read as another
    // product name.
    if (line.detail) {
      lines.push(...indent(wrapText(line.detail, width - 2)));
    }

    // The per-line discount, ONLY when there is one.
    if (line.discountPercent > 0) {
      lines.push(`  ${trimPercent(line.discountPercent)}% off`);
    }

    /**
     * A CHILLED line prints the COMBINED unit price, with a marker.
     *
     * `3 × 305.00` must be what multiplies out to the line total, or the receipt
     * fails the only test that matters — a customer checking it with a
     * calculator in front of the owner. The `chilled` marker is what explains
     * why that bottle costs more than the shelf price.
     */
    const chilled = (line.coolingRate ?? 0) > 0;
    if (chilled) lines.push(`  chilled +${bareAmount(line.coolingRate ?? 0)}/unit`);

    lines.push(
      padRow(
        `  ${formatQuantity(line.quantity, line.unit, line.unitName)} × ${bareAmount(
          line.unitPrice + (line.coolingRate ?? 0)
        )}`,
        amount(line.lineTotal),
        width
      )
    );
  }

  lines.push(divider("-", width));

  // -- Totals ---------------------------------------------------------------
  /**
   * The Subtotal row prints ONLY when it differs from the total — i.e. only when
   * a whole-bill discount actually took something off.
   *
   * A subtotal exists to explain a discount. With no discount it is the same
   * figure as TOTAL, and printing both spends a line saying the number twice,
   * which invites the customer to wonder what the difference is. The owner's
   * answer on the mixed receipt was explicit: one flat list, one total.
   */
  if (receipt.subtotal !== receipt.totalAmount) {
    lines.push(padRow("Subtotal", amount(receipt.subtotal), width));
  }

  if (receipt.discountPercent > 0) {
    // The saving, shown as the gap between the lines and the stored total —
    // exactly how the on-screen detail presents it, and never recomputed from
    // the percentage.
    const saving = receipt.subtotal - receipt.totalAmount;
    lines.push(
      padRow(
        `Discount (${trimPercent(receipt.discountPercent)}%)`,
        `-${amount(saving)}`,
        width
      )
    );
  }

  lines.push(padRow("TOTAL", amount(receipt.totalAmount), width));
  lines.push(divider("=", width));

  // -- Footer ---------------------------------------------------------------
  lines.push(...centreLines("Thank you", width));

  return clampLines(lines, width);
}

/**
 * The prefix that marks the TOTAL row, for renderers that emphasise it.
 *
 * Exported so `lib/escpos.ts` does not carry its own copy of the string — if
 * the row's label ever changes, both move together.
 */
export const TOTAL_ROW_PREFIX = "TOTAL";
