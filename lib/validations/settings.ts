import { z } from "zod";

import { isPlaceholderValue } from "@/lib/settings-display";

/**
 * Validation for `PATCH /api/settings`.
 *
 * All three fields are sent together — the screen is one small form with one
 * Save, so there is no partial-update case to support and no reason to let a
 * caller send half a shop.
 *
 * ---------------------------------------------------------------------------
 * NO FORMAT VALIDATION ON PHONE OR ADDRESS. DECIDED — DO NOT ADD IT LATER.
 * ---------------------------------------------------------------------------
 * These are the owner's own contact details, entered once, printed on his own
 * receipt. There is no standard format: he may list two numbers, a landline and
 * a mobile, a number with an extension, or an address written however his
 * customers recognise it. Any pattern check is far more likely to reject
 * something valid than to catch a real mistake — and a real mistake is one he
 * sees on his own receipt and fixes himself in thirty seconds.
 *
 * A phone regex here would be a stranger telling a shop owner his own phone
 * number is wrong. Strictness belongs in the money maths, not in free text.
 *
 * The only two constraints are therefore:
 *   - TRIM, so a stray leading space does not shift the receipt line, and
 *   - a MAX LENGTH, so a huge paste cannot break the receipt layout.
 *
 * The phone cap is 60 rather than 30 deliberately: "0300-1234567 / 042-35678901"
 * is already 27 characters, so 30 would reject a perfectly ordinary two-number
 * listing — the exact false rejection this rule exists to avoid.
 */

/**
 * Optional text: trimmed, and an empty string becomes NULL.
 *
 * "" and null must not both be storable. `null` means "the shop has no phone",
 * which the receipt honours by omitting the line; an empty string would print an
 * empty line and read as a formatting bug.
 */
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `${label} must be ${max} characters or fewer` })
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

/**
 * Reject the seeded placeholder as a submitted value.
 *
 * The form pre-fills from the stored row, so without this the owner could fix
 * the shop name, hit Save, and silently promote the untouched
 * "SET PHONE IN SETTINGS" into a real phone number that then prints on receipts
 * as though he had chosen it. The UI avoids the situation by not pre-filling
 * placeholders; this is the backstop, and it is the boundary that matters
 * because it is the one the database is behind.
 */
const notPlaceholder = (label: string) => (value: string | null) =>
  !isPlaceholderValue(value) || `That is the placeholder text — enter your real ${label}.`;

export const settingsUpdateSchema = z.object({
  shopName: z
    .string()
    .trim()
    .min(1, { message: "Shop name is required" })
    .max(80, { message: "Shop name must be 80 characters or fewer" })
    .refine(
      (value) => notPlaceholder("shop name")(value) === true,
      { message: "That is the placeholder text — enter your real shop name." }
    ),
  shopPhone: optionalText("Phone", 60).refine(
    (value) => notPlaceholder("phone number")(value) === true,
    { message: "That is the placeholder text — enter your real phone number." }
  ),
  shopAddress: optionalText("Address", 200).refine(
    (value) => notPlaceholder("address")(value) === true,
    { message: "That is the placeholder text — enter your real address." }
  ),
});

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
