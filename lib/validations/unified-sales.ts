import { z } from "zod";

import { startOfKarachiDay } from "@/lib/format";

/**
 * Validation for the UNIFIED sale endpoints — THE sale schema since S9.
 *
 * It used to sit alongside `lib/validations/sales.ts`, whose quantity was
 * `.int()` because 2.5 bottles of Pepsi is a typo. That file went with the
 * per-module routes in S9; a quantity here is DECIMAL, because milk sells in
 * fractional litres and one bill can now hold milk and bottles together.
 *
 * Dates follow the Karachi-day rule (Gotcha 4) — a bare `yyyy-MM-dd` becomes
 * the UTC instant of Karachi midnight on that day.
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

/** Left as a string: the route applies start-of-day vs end-of-day itself. */
const dateBoundary = z
  .string()
  .trim()
  .min(1)
  .refine(isRealDate, { message: "That date filter isn't a valid date" });

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
    /**
     * COOLING (Migration E) — a BOOLEAN, never a rate.
     *
     * The owner's instruction was explicit: the charge is set in the catalog and
     * the bill only carries a toggle. So the client says *whether* this line was
     * chilled and the SERVER reads the amount off the product. There is exactly
     * one place the number lives, and no second price channel to police.
     *
     * Sending `chilled: true` for a product with NO cooling charge is a 400,
     * not a silent 0 — it means the till offered a toggle it should not have,
     * and swallowing it would hide the bug while charging nothing.
     */
    chilled: z.boolean().optional(),
    /**
     * The SELLING UNIT's name (S8) — "dozen", "tray", "peti", "pet 6".
     *
     * A NAME, never a factor or a price: the server looks the unit up on the
     * product and takes both from there. A client-supplied factor is the one
     * value that could silently drain stock — a peti recorded as one egg, or 360
     * eggs taken for a dozen — so it is not accepted at all.
     *
     * Omitted = the base unit, which is every line before S8.
     */
    unitName: z.string().min(1).max(40).optional(),
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
    /**
     * NEW lines only. On an EXISTING line the stored `coolingRate` is kept and
     * this is ignored — the same rule as `unitPrice`, for the same reason:
     * cooling is part of what was charged, and a printed bill must not change
     * because someone re-opened it. The edit screen does not offer the toggle
     * on a stored line.
     */
    chilled: z.boolean().optional(),
    /**
     * The SELLING UNIT's name (S8) — "dozen", "tray", "peti", "pet 6".
     *
     * A NAME, never a factor or a price: the server looks the unit up on the
     * product and takes both from there. A client-supplied factor is the one
     * value that could silently drain stock — a peti recorded as one egg, or 360
     * eggs taken for a dozen — so it is not accepted at all.
     *
     * Omitted = the base unit, which is every line before S8.
     */
    unitName: z.string().min(1).max(40).optional(),
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

/**
 * The sale LIST query. Moved here in S9 from `lib/validations/sales.ts`, which
 * went with the per-module routes.
 *
 * `module` is new, and it is the replacement for the deleted /beverages and
 * /bakery screens: those were the only way to see one shop's bills, so the
 * unified list had to gain the filter before they could go.
 *
 * It matches a sale that has AT LEAST ONE LINE in that module — not a sale
 * whose every line is. A mixed bill genuinely belongs in both shops' lists, and
 * hiding it from one of them would understate what that shop sold.
 */
export const unifiedSaleListQuerySchema = z.object({
  customerId: id.optional(),
  dateFrom: dateBoundary.optional(),
  dateTo: dateBoundary.optional(),
  module: z.enum(["beverages", "bakery", "milk"]).optional(),
  // `coerce` because these arrive as query-string text.
  page: z.coerce
    .number({ message: "Page must be a number" })
    .int()
    .min(1, { message: "Page must be at least 1" })
    .default(1),
  limit: z.coerce
    .number({ message: "Limit must be a number" })
    .int()
    .min(1, { message: "Limit must be at least 1" })
    .max(100, { message: "Limit cannot exceed 100" })
    .default(10),
});

export type UnifiedSaleListQuery = z.infer<typeof unifiedSaleListQuerySchema>;
