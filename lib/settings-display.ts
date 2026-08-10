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
 * **58mm roll: 384-dot print head / 12 dots per character = 32 characters.**
 *
 * 58mm is the DEFAULT-WHEN-UNSURE choice, and the reason is asymmetric risk: a
 * layout built for 58mm also prints on 80mm (it just leaves margin), while an
 * 80mm layout OVERFLOWS 58mm and wraps into nonsense. The owner's actual printer
 * is unknown — nothing in this repo has ever recorded one — so the narrow
 * assumption is the safe one.
 *
 * If the printer is later confirmed as 80mm, this becomes 48 (576-dot head) and
 * the shop-name cap moves with it, because it is derived from this constant
 * rather than copied. Full reasoning: "Receipt printing" in CLAUDE.md.
 *
 * NOTE for the receipt renderer: double-width header text halves this to 16.
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
