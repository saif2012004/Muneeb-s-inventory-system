import { z } from "zod";

import { startOfKarachiDay } from "@/lib/format";

/**
 * Validation for the UNIFIED sale endpoint (`POST /api/sales`).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SITS ALONGSIDE `lib/validations/sales.ts` RATHER THAN REPLACING IT
 * ---------------------------------------------------------------------------
 * The per-module schema types quantity as `.int()`, and that must STAY strict:
 * 2.5 bottles of Pepsi is a typo, and `/api/beverages/sales` should keep
 * rejecting it. The unified endpoint has the opposite requirement — milk sells
 * in fractional litres — so it gets its OWN schema instead of the shared one
 * being loosened for everybody.
 *
 * Both are live at once, deliberately. Do not "consolidate" them: the whole
 * point is that the two endpoints disagree about what a quantity may be.
 *
 * Dates follow the same Karachi-day rule as the per-module schema (Gotcha 4) —
 * a bare `yyyy-MM-dd` becomes the UTC instant of Karachi midnight on that day.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const id = z.string().min(1, { message: "A valid id is required" });

/** Decimal(10, 2) tops out at 99,999,999.99. */
const money = z
  .number({ message: "Price must be a number" })
  .min(0, { message: "Price cannot be negative" })
  .max(99_999_999.99, { message: "Price is too large" });

/**
 * A DECIMAL quantity — this is the difference from the per-module schema.
 *
 * Two decimal places, matching `SaleItem.quantity numeric(10,2)`, so a value
 * that validates always survives the round trip unchanged. It is also what
 * makes the arithmetic exact: `computeLineTotal` multiplies a JS number into a
 * Decimal, and decimal.js builds from a number's shortest round-trip decimal
 * form — so 12.5 and 0.07 are exact, while a THIRD decimal place would not be.
 *
 * `.positive()` not `.min(1)`: half a litre is a real sale. Zero is not — a
 * zero-quantity line is a line that should have been removed, and it would
 * decrement no stock while still printing on the receipt.
 */
const quantity = z
  .number({ message: "Quantity must be a number" })
  .positive({ message: "Quantity must be greater than zero" })
  .max(1_000_000, { message: "Quantity is too large" })
  .multipleOf(0.01, { message: "Quantity can have at most 2 decimal places" });

const notes = z
  .string()
  .trim()
  .max(500, { message: "Notes must be 500 characters or fewer" })
  .nullable()
  .optional();

function isRealDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

const saleDate = z
  .string()
  .trim()
  .min(1, { message: "Sale date is required" })
  .refine(isRealDate, { message: "That sale date isn't a valid date" })
  .transform((value) =>
    DATE_ONLY.test(value) ? startOfKarachiDay(value) : new Date(value)
  );

/**
 * `unitPrice` is an OPTIONAL OVERRIDE on CREATE, exactly as in the per-module
 * schema: the seed ships every product at price 0, so the owner has to be able
 * to bill a real price before walking the whole catalog.
 *
 * ⚠️ `.strict()` — an unknown key is a 400, and that is aimed squarely at
 * `discountPercent`. This endpoint has NO discount, at line or bill level, and
 * silently dropping one a caller believed had applied would put a wrong number
 * on a customer's receipt. A 400 is a five-second fix; a quietly-ignored
 * discount is an argument in the shop. (Money is computed server-side, so
 * `lineTotal`/`netLineTotal`/`totalAmount` are rejected here too — they are
 * never accepted from a client.)
 */
export const unifiedSaleItemCreateSchema = z
  .object({
    productId: id,
    quantity,
    unitPrice: money.optional(),
  })
  .strict();

export const unifiedSaleCreateSchema = z
  .object({
    customerId: id,
    saleDate,
    notes,
    items: z
      .array(unifiedSaleItemCreateSchema)
      .min(1, { message: "Add at least one item to the sale." })
      .max(100, { message: "A sale can hold at most 100 lines." }),
  })
  .strict();

export type UnifiedSaleCreateInput = z.infer<typeof unifiedSaleCreateSchema>;

/**
 * The UPDATE form of a line. `id` present = an existing line kept or edited;
 * `id` absent = a new line. Any stored line NOT in the submitted array is
 * removed from the sale.
 *
 * ⚠️ `unitPrice` IS ACCEPTED HERE AND IGNORED FOR AN EXISTING LINE. That is not
 * an oversight — it is CHECKLIST #7, closed 2026-08-11: `reconcileSaleLines`
 * takes an existing line's price from the database or the stored snapshot and
 * never from the client, because honouring it would let a closed bill be
 * silently re-priced. It stays ACCEPTED rather than rejected because the sale
 * form always sends one and a NEW line in the same array legitimately uses it.
 *
 * Do not "tighten" this into a rejection without checking the form: a 400 on a
 * field the UI always sends would break every edit, and the value is already
 * inert where it matters.
 */
export const unifiedSaleItemUpdateSchema = z
  .object({
    id: id.optional(),
    productId: id,
    quantity,
    unitPrice: money.optional(),
  })
  .strict();

/**
 * PATCH /api/sales/[id].
 *
 * Every field optional. **Omitting `items` edits the header only** and leaves
 * every line — and therefore every price snapshot — completely untouched; that
 * is the safe edit.
 *
 * `.strict()` for the same reason as create: this endpoint has NO discounts, and
 * silently dropping one a caller believed had applied would put a wrong number
 * on a customer's bill.
 */
export const unifiedSaleUpdateSchema = z
  .object({
    saleDate: saleDate.optional(),
    notes,
    items: z
      .array(unifiedSaleItemUpdateSchema)
      .min(1, { message: "A sale must keep at least one item." })
      .max(100, { message: "A sale can hold at most 100 lines." })
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export type UnifiedSaleUpdateInput = z.infer<typeof unifiedSaleUpdateSchema>;
