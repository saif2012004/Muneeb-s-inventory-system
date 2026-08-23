import { buildReceiptLines, shopNameLineCount, TOTAL_ROW_PREFIX } from "@/lib/receipt-lines";
import type { ReceiptData } from "@/lib/receipt";

/**
 * The receipt as NATIVE ESC/POS bytes, for a printer we talk to directly.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE THE BROWSER PATH
 * ---------------------------------------------------------------------------
 * `window.print()` hands the page to a driver, which rasterises it into a
 * picture. That works, but it goes through Android's print framework, which
 * needs a print-service app because the Speed-X SP-90A speaks only raw ESC/POS
 * (no IPP — port 631 is closed, verified 2026-08-22).
 *
 * These bytes go to the printer's own firmware instead: its built-in Font A,
 * its own cutter, no rasterising and no driver. Over USB (WebUSB) the browser
 * can deliver them with no third-party app at all.
 *
 * ---------------------------------------------------------------------------
 * 🔴 48 COLUMNS HERE, 32 IN THE BROWSER. DELIBERATE — DO NOT "FIX".
 * ---------------------------------------------------------------------------
 * The 72mm print head is 576 dots; Font A is 12 dots wide, so 576/12 = 48
 * characters, and the firmware's own glyphs are 12x24 dots = 1.5 x 3.0mm.
 *
 * The browser at the same 48 columns renders ~1.43 x 2.4mm and the owner could
 * NOT read it — which is why the browser path was dropped to 32. Printed
 * natively at 48 he reads it fine (three-way comparison on real paper,
 * 2026-08-22, he picked normal Font A). Same paper, same head, different
 * renderer, different legible density.
 *
 * So: the browser keeps 32 and this keeps 48. They are not two answers to one
 * question.
 */

/** Characters per line at Font A on a 72mm head: 576 dots / 12 dots per char. */
export const ESCPOS_LINE_CHARS = 48;

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** `ESC @` — reset to a known state. Always the first thing sent. */
const INIT = [ESC, 0x40];

/** `ESC a n` — 0 left, 1 centre, 2 right. */
const alignLeft = [ESC, 0x61, 0x00];
const alignCentre = [ESC, 0x61, 0x01];

/**
 * `GS ! n` — character size. High nibble is width-1, low nibble is height-1.
 *
 * ⚠️ DOUBLE **WIDTH** BREAKS ANY LINE BUILT ON THE CHARACTER GRID, because the
 * padding spaces that align the money column double along with the text. Only
 * apply it to a line that is centred by `ESC a 1` on a TRIMMED string.
 *
 * Double **height** is safe on the grid: it changes no horizontal metric, so a
 * padded row stays aligned. That is why TOTAL gets height and not width.
 */
const sizeNormal = [GS, 0x21, 0x00];
const sizeDoubleHeight = [GS, 0x21, 0x01];
const sizeDoubleBoth = [GS, 0x21, 0x11];

/** `GS V 66 n` — feed n dots and partial-cut. The SP-90A has a cutter. */
const CUT = [GS, 0x56, 0x42, 0x00];

/**
 * 🔴 TYPOGRAPHIC CHARACTERS THE RECEIPT ACTUALLY USES, MAPPED TO ASCII.
 *
 * Found by printing a fixture through this module: the quantity row is built
 * with `×` (U+00D7) and a product detail with `·` (U+00B7). Both are outside
 * ASCII, so without this map they encoded to `?` and the roll read
 *
 *     2 peti ? 7,000.00                Rs. 14,000.00
 *
 * which destroys the one job the receipt has — letting the customer check the
 * arithmetic with a calculator (see the paise rule in `lib/receipt-lines.ts`).
 * `tsc`, `next lint` and a production build were all green with that in place.
 *
 * ⚠️ EVERY MAPPING MUST BE EXACTLY ONE CHARACTER LONG. The lines arrive already
 * padded and clamped to the column grid, so replacing one character with two
 * would push the money column out of alignment — the very thing the grid exists
 * to hold. `…` therefore becomes `.`, not `...`.
 */
const ASCII_SUBSTITUTES: Record<string, string> = {
  "×": "x", // × multiplication sign — the quantity rows
  "·": "-", // · middle dot — the product-detail separator
  "–": "-", // – en dash
  "—": "-", // — em dash
  "‘": "'", // ' left single quote
  "’": "'", // ' right single quote / apostrophe
  "“": '"', // " left double quote
  "”": '"', // " right double quote
  "…": ".", // … ellipsis — ONE char, see the warning above
  " ": " ", // non-breaking space
};

/**
 * Text -> printer bytes.
 *
 * ⚠️ ASCII ONLY. The printer decodes single-byte code pages, not UTF-8; sending
 * UTF-8 for a non-Latin character produces two bytes of garbage rather than one
 * wrong glyph. Known typographic characters are transliterated above; anything
 * else outside ASCII becomes `?` — visibly wrong, which is the point. A silently
 * mangled name on a customer's receipt is worse than an obvious one the owner
 * will report.
 *
 * This is a real limitation of the native path that the browser path does not
 * have. If the shop name or address is ever entered in Urdu, that content needs
 * the browser path (or a code-page change here).
 */
function encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const substitute = ASCII_SUBSTITUTES[ch] ?? ch;
    const code = substitute.codePointAt(0) ?? 0x3f;
    out.push(code < 0x80 ? code : 0x3f);
  }
  return out;
}

/** One text line plus its terminator. */
function line(text: string): number[] {
  return [...encode(text), LF];
}

/**
 * Build the whole receipt as ESC/POS.
 *
 * The text comes from the SAME `buildReceiptLines` the browser uses — only the
 * width and the presentation differ. Nothing about the money, the rounding or
 * the column layout is re-derived here.
 */
export function buildEscPosReceipt(receipt: ReceiptData): Uint8Array {
  const width = ESCPOS_LINE_CHARS;
  const lines = buildReceiptLines(receipt, width);

  /**
   * 🔴 THE SHOP NAME IS DROPPED FROM THE TEXT AND REDRAWN BY THE PRINTER.
   *
   * `buildReceiptLines` centres it by PADDING WITH SPACES to fill 48 columns.
   * Print that padded string at double size and the padding doubles too — the
   * name walks right and off the 72mm head. So the padded copy is sliced off and
   * the name is sent TRIMMED, centred by the printer's own `ESC a 1`.
   *
   * Exactly the trap `ReceiptDocument.tsx` documents for CSS; same fix, printer
   * commands instead of stylesheet.
   */
  const nameLines = shopNameLineCount(receipt, width);
  const body = lines.slice(nameLines);

  const bytes: number[] = [...INIT];

  // -- Shop name: double size, printer-centred, trimmed --------------------
  bytes.push(...alignCentre, ...sizeDoubleBoth);
  bytes.push(...line(receipt.settings.shopName.trim()));
  bytes.push(...sizeNormal, ...alignLeft);

  // -- Everything else: normal Font A on the 48-column grid -----------------
  for (const text of body) {
    /**
     * TOTAL is emphasised with double HEIGHT only — see the `GS !` note above.
     * Matched on the row's prefix, which is shared with the builder via
     * `TOTAL_ROW_PREFIX` so the two cannot drift apart.
     *
     * Presentation only: if the match ever fails the row still prints, just
     * without emphasis. It cannot corrupt the bill.
     */
    if (text.startsWith(TOTAL_ROW_PREFIX)) {
      bytes.push(...sizeDoubleHeight, ...line(text), ...sizeNormal);
    } else {
      bytes.push(...line(text));
    }
  }

  // Feed clear of the head before cutting, or the last lines sit inside the
  // mechanism and the customer gets a receipt missing its footer.
  bytes.push(LF, LF, LF, ...CUT);

  return Uint8Array.from(bytes);
}
