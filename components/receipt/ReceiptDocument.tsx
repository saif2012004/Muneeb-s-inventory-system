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
 * standard symbol and no shop owner will misread it, whereas "12…" tells the
 * customer nothing. The SCREEN still says "litres" — it has the room.
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
  // `5 kms` is. It is also already short, so unlike "litres" it costs the line
  // budget nothing to print as-is. Mirrors UNPLURALISED_UNITS in
  // lib/sale-catalog.ts, which is the screen's copy of the same rule.
  if (unit === "kg") return `${quantity} kg`;
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

    /**
     * A CHILLED line prints the COMBINED unit price, with a marker.
     *
     * `3 × 305.00` must be what multiplies out to the line total, or the receipt
     * fails the only test that matters — a customer checking it with a
     * calculator in front of the owner (see the paise rule above). The `chilled`
     * marker is what explains why that bottle costs more than the shelf price.
     */
    const chilled = (line.coolingRate ?? 0) > 0;
    if (chilled) lines.push(`  chilled +${bareAmount(line.coolingRate ?? 0)}/unit`);

    lines.push(
      padRow(
        `  ${formatQuantity(line.quantity, line.unit, line.unitName)} × ${bareAmount(
          line.unitPrice + (line.coolingRate ?? 0)
        )}`,
        amount(line.lineTotal)
      )
    );
  }

  lines.push(divider());

  // -- Totals ---------------------------------------------------------------
  /**
   * The Subtotal row prints ONLY when it differs from the total — i.e. only when
   * a whole-bill discount actually took something off.
   *
   * A subtotal exists to explain a discount. With no discount it is the same
   * figure as TOTAL, and printing both spends a line of a 32-character roll
   * saying the number twice, which invites the customer to wonder what the
   * difference is. The owner's answer on the mixed receipt was explicit: one
   * flat list, one total (2026-08-14).
   *
   * Every unified sale is in this case by construction — that endpoint has no
   * discounts at all — and so is any per-module bill sold at full price. A
   * discounted bill is unchanged: Subtotal, Discount and TOTAL all still print.
   */
  if (receipt.subtotal !== receipt.totalAmount) {
    lines.push(padRow("Subtotal", amount(receipt.subtotal)));
  }

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
  const lines = buildReceiptLines(receipt);

  /**
   * THE SHOP NAME IS BOLD — presentation only, and that distinction matters.
   *
   * `buildReceiptLines` is deliberately NOT changed to do this. It returns the
   * exact text of the roll, and the browser verification asserts that no line it
   * produces exceeds `RECEIPT_LINE_CHARS`; putting markup inside it would make
   * that check meaningless. So the text is built first, and only its opening
   * lines are wrapped for display.
   *
   * ⚠️ Bold is SAFE for the line budget where double-width would not be. A bold
   * monospace glyph occupies the same cell, so 32 characters still fit — the
   * Design System's warning that double-width halves the budget to 16 does not
   * apply to weight.
   *
   * `centreLines` is called again rather than the count being hardcoded: a shop
   * name up to the 32-character cap (CHECKLIST #2b) is one line today, but the
   * count is derived so a wrapped name cannot silently leave half the header
   * unbolded.
   */
  const nameLineCount = centreLines(receipt.settings.shopName).length;
  const restText = lines.slice(nameLineCount).join("\n");

  return (
    // `receipt-paper` sizes the roll and is the ONLY thing @media print keeps.
    <pre className="receipt-paper" data-line-chars={RECEIPT_LINE_CHARS}>
      {/**
       * 🔴 The name is rendered from `settings.shopName` DIRECTLY, not from the
       * built line — and the built line is dropped (`slice(nameLineCount)`) so
       * it cannot appear twice.
       *
       * Why not reuse the text: `centreLines` centres by prepending SPACES to
       * fill a 32-character grid. Those spaces are glyphs. Enlarge the font and
       * the padding enlarges with it, shoving the name right and off the roll.
       * A bigger name therefore has to be centred by CSS, on the trimmed string.
       *
       * Everything BELOW the name still comes from `buildReceiptLines`
       * untouched, so the character-grid alignment the money columns depend on
       * is unaffected.
       */}
      <strong className="receipt-shop-name">
        {receipt.settings.shopName.trim()}
      </strong>
      {restText}
    </pre>
  );
}
