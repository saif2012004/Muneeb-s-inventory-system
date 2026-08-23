import { RECEIPT_LINE_CHARS } from "@/lib/settings-display";
import { buildReceiptLines, shopNameLineCount } from "@/lib/receipt-lines";
import type { ReceiptData } from "@/lib/receipt";

/**
 * The 58mm/80mm thermal receipt as the BROWSER renders it — `window.print()`.
 *
 * The text itself is built by `buildReceiptLines` in `lib/receipt-lines.ts`,
 * which is shared with the native ESC/POS path (`lib/escpos.ts`). This file is
 * only the browser's presentation of it.
 *
 * ⚠️ THIS PATH USES `RECEIPT_LINE_CHARS` (32). THE ESC/POS PATH USES 48.
 * They diverge deliberately — the browser rasterises a web font that the owner
 * could not read at 48 columns, while the printer's own Font A at 48 is legible
 * (verified on paper, 2026-08-22). See the header of `lib/receipt-lines.ts`.
 */
export { buildReceiptLines };

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
   * Design System's warning that double-width halves the budget does not apply
   * to weight.
   *
   * `shopNameLineCount` is derived rather than the count being hardcoded: a shop
   * name up to the cap (CHECKLIST #2b) is one line today, but the count is
   * computed so a wrapped name cannot silently leave half the header unbolded.
   */
  const nameLineCount = shopNameLineCount(receipt);
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
       * fill the character grid. Those spaces are glyphs. Enlarge the font and
       * the padding enlarges with it, shoving the name right and off the roll.
       * A bigger name therefore has to be centred by CSS, on the trimmed string.
       *
       * The ESC/POS path has the identical trap and solves it the same way, with
       * `ESC a 1` instead of CSS.
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
