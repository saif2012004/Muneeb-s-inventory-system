/**
 * Settings values and placeholder logic that the BROWSER needs.
 *
 * Dependency-free on purpose — `lib/settings.ts` imports Prisma and is
 * server-only, so anything a client component needs lives here. Same split as
 * receivables / receivables-display and milk / milk-display.
 */

/** The one row. Every read is `where: { id: SETTINGS_ID }`. */
export const SETTINGS_ID = "app";

/**
 * THE RECEIPT PAPER WIDTH, as a character budget. One line, ESC/POS Font A.
 *
 * **32 characters — a LEGIBILITY choice, not a hardware limit (2026-08-22).**
 *
 * The hardware would take 48: the Speed-X SP-90A has a 576-dot head and Font A
 * is 12 dots wide, so 576/12 = 48 fits exactly. It was set to 48 for two days
 * and the owner printed it. **His verdict on the real paper: too small to
 * read.** He is right, and the arithmetic says why — 48 characters across a
 * 72mm head is 1.43mm per character, and a browser's monospace font at that
 * advance stands only ~2.4mm tall, noticeably shorter than the printer's own
 * Font A.
 *
 * **Characters per line is the ONLY lever on printed text size.** The head is
 * 72mm no matter what; the only way a character gets bigger is for fewer of
 * them to share that width. At 32 each character gets 2.19mm instead of 1.43mm
 * — **1.5x taller and 1.5x wider, so 2.35x the ink area.**
 *
 * The cost, and it is real: the phone line and the address no longer fit on one
 * line and wrap to two, which is exactly what moving 32 -> 48 bought on
 * 2026-08-20. That trade is now reversed deliberately. **A receipt the owner
 * cannot read is not made better by fitting his address on one line.**
 *
 * ---------------------------------------------------------------------------
 * 🔴 THIS IS THE ONLY PLACE THE WIDTH IS DECIDED. NEVER HARDCODE 48.
 * ---------------------------------------------------------------------------
 * Dividers, text wrapping, centring, padded money rows, the line clamp AND the
 * `shopName` length cap all derive from this one number. That is precisely why
 * changing paper size is a one-line edit here instead of a layout rewrite —
 * keep it that way.
 *
 * ⚠️ **`.receipt-paper { width }` in app/globals.css is the OTHER half and does
 * NOT derive from this.** This constant is the character grid; the CSS is the
 * physical paper the browser prints onto. Change one without the other and you
 * get 48-character lines squeezed into a 58mm page, or a 32-character receipt
 * marooned in the middle of an 80mm one.
 *
 * History: 32 until 2026-08-20 (58mm assumed), 48 for two days once an 80mm
 * printer was confirmed, back to 32 on 2026-08-22 once one was actually
 * PRINTED FROM. The number is the same as the original by coincidence, not by
 * reversal — it was a paper-width guess then and it is a legibility decision
 * now, and 32 is comfortably inside what the 72mm head can render.
 *
 * ⚠️ **Going lower is possible and gets bigger still — 24 characters would be
 * 2.9mm each, a true doubling — but 24 is where the money column starts to
 * break.** `TOTAL` plus `Rs. 3,500.00` is already 22 of those 24. Do not go
 * below 32 without rebuilding the line layout.
 *
 * NOTE for the receipt renderer: double-width header text halves this to 24.
 * That is a RENDERING decision — print a long name at normal width rather than
 * letting the validator reject a real shop name that would fit perfectly.
 */
export const RECEIPT_LINE_CHARS = 32;

/**
 * THE SEEDED PLACEHOLDERS. Deliberately jarring, and they must stay that way.
 *
 * A receipt printed before setup has to be OBVIOUSLY unconfigured. A friendly
 * placeholder — "Your Shop Name", or a blank line — prints something that looks
 * finished and is wrong, and the customer walks away holding it. Shouting at the
 * owner in his own receipt header is the cheapest possible way to make sure that
 * never leaves the shop.
 *
 * These strings must match the seed INSERT in
 * `prisma/migrations/20260810120000_add_settings/migration.sql` exactly.
 */
export const SETTINGS_PLACEHOLDERS = {
  shopName: "SET SHOP NAME IN SETTINGS",
  shopPhone: "SET PHONE IN SETTINGS",
  shopAddress: "SET ADDRESS IN SETTINGS",
} as const;

const PLACEHOLDER_VALUES: string[] = Object.values(SETTINGS_PLACEHOLDERS);

/** The shape the API returns. Dates are ISO strings across the boundary. */
export type Settings = {
  shopName: string;
  shopPhone: string | null;
  shopAddress: string | null;
  /** null until the owner has saved his real details at least once. */
  configuredAt: string | null;
  updatedAt: string;
};

/**
 * Is this exact value one of the seeded placeholders?
 *
 * Used for two narrow jobs: greying the placeholder text in the form, and
 * refusing to SAVE a placeholder as though it were a real value (the input is
 * pre-filled, so "edit the name, hit save" would otherwise quietly promote the
 * untouched phone placeholder into a real phone number).
 *
 * It is deliberately NOT how "is the shop configured" is answered — that is
 * `configuredAt`, a recorded fact. Matching on text would silently stop
 * detecting anything the day someone edits the wording above.
 */
export function isPlaceholderValue(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && PLACEHOLDER_VALUES.includes(value);
}

/**
 * Has the owner saved his real details? THE go-live check (CHECKLIST #2b).
 *
 * Reads the recorded fact, not the current text.
 */
export function isConfigured(settings: Pick<Settings, "configuredAt">): boolean {
  return settings.configuredAt !== null;
}

/**
 * What the receipt header should print for a field, or null to omit the line.
 *
 * Kept here rather than in the receipt so the rule is decided once: an
 * unconfigured shop prints the shouting placeholder (that is the whole point),
 * and a genuinely empty optional field prints nothing at all.
 */
export function receiptLine(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
