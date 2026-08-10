import { z } from "zod";

import { startOfKarachiDay } from "@/lib/format";

/**
 * Sale validation, shared by the API routes and (from 3.2) the sale forms.
 * Zod only — no Prisma import — so this is safe in a client component.
 *
 * ---------------------------------------------------------------------------
 * DATES ARE KARACHI DATES (Gotcha 4)
 * ---------------------------------------------------------------------------
 * The owner picks a calendar day, not an instant. A bare `"2026-08-03"` parses
 * as UTC midnight, which is 05:00 on the 3rd in Karachi — fine — but a sale
 * entered at 11pm Karachi on the 3rd is already the 4th in UTC, and bucketing
 * it with `new Date()` would file it under the wrong day.
 *
 * So a `yyyy-MM-dd` input is converted to the UTC instant of Karachi midnight
 * on that day. Storage stays UTC; the day it belongs to is a Karachi day.
 * A full ISO timestamp is passed through as the exact instant it names.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const id = z.string().min(1, { message: "A valid id is required" });

/** Decimal(10, 2) tops out at 99,999,999.99. */
const money = z
  .number({ message: "Price must be a number" })
  .min(0, { message: "Price cannot be negative" })
  .max(99_999_999.99, { message: "Price is too large" });

const quantity = z
  .number({ message: "Quantity must be a number" })
  .int({ message: "Quantity must be a whole number" })
  .min(1, { message: "Quantity must be at least 1" })
  .max(1_000_000, { message: "Quantity is too large" });

const notes = z
  .string()
  .trim()
  .max(500, { message: "Notes must be 500 characters or fewer" })
  .nullable()
  .optional();

/**
 * A discount PERCENTAGE — the owner types `5` and means 5%.
 *
 * Clamped 0–100 at the edge, deliberately, rather than trusted and clamped in
 * the maths. Above 100 would make a line total NEGATIVE, which the Decimal(10,2)
 * column would happily store and every "revenue" figure in reports would then
 * silently subtract. Below 0 would be a mark-up wearing a discount's name.
 *
 * Not an integer: 7.5% is a real thing a shop gives. Two decimal places matches
 * the DECIMAL(5,2) column, so a value that validates always survives the round
 * trip unchanged.
 *
 * Defaults to 0 rather than being nullable — null and 0% mean the same thing,
 * and this project has already lost time to exactly that ambiguity (back when
 * products carried a discount, a bakery product storing `discountPercent = 0`
 * instead of null broke a falsy check and printed "0% off" on every row; see
 * docs/phase-4-bakery-module.md. That column was dropped in CHECKLIST #9 —
 * the lesson about 0-vs-null is why this one defaults rather than nulls).
 */
const discountPercent = z
  .number({ message: "Discount must be a number" })
  .min(0, { message: "Discount cannot be negative" })
  .max(100, { message: "Discount cannot be more than 100%" })
  .multipleOf(0.01, { message: "Discount can have at most 2 decimal places" })
  .default(0);

function isRealDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/** `"2026-08-03"` or a full ISO string -> a UTC `Date`. */
const saleDate = z
  .string()
  .trim()
  .min(1, { message: "Sale date is required" })
  .refine(isRealDate, { message: "That sale date isn't a valid date" })
  .transform((value) =>
    DATE_ONLY.test(value) ? startOfKarachiDay(value) : new Date(value)
  );

/** Left as a string: the route applies start-of-day vs end-of-day itself. */
const dateBoundary = z
  .string()
  .trim()
  .min(1)
  .refine(isRealDate, { message: "That date filter isn't a valid date" });

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

/**
 * `unitPrice` is an OPTIONAL OVERRIDE, not the price. Omit it and the server
 * snapshots the current catalog price (Gotcha 5). Send it and that value is
 * used verbatim — which is how the owner sells a seeded product still sitting
 * at price 0 without editing the catalog first.
 *
 * `lineTotal` and `totalAmount` are deliberately absent: money is computed
 * server-side and a client-supplied total is never trusted.
 */
export const saleItemCreateSchema = z.object({
  productId: id,
  quantity,
  unitPrice: money.optional(),
  /** Per-LINE discount. Applied before the whole-bill discount. */
  discountPercent,
});

/**
 * The PATCH form of a line. `id` present = an existing line being kept or
 * edited; `id` absent = a new line to add. Any existing line NOT present in the
 * submitted array is removed from the sale.
 */
export const saleItemUpdateSchema = saleItemCreateSchema.extend({
  id: id.optional(),
});

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export const saleCreateSchema = z.object({
  customerId: id,
  saleDate,
  notes,
  /** Whole-bill discount, applied to the subtotal of already-discounted lines. */
  discountPercent,
  items: z
    .array(saleItemCreateSchema)
    .min(1, { message: "Add at least one item to the sale." })
    .max(100, { message: "A sale can hold at most 100 lines." }),
});

/**
 * Every field optional. Omitting `items` edits the header only and leaves every
 * line — and therefore every price snapshot — completely untouched.
 */
export const saleUpdateSchema = z
  .object({
    saleDate: saleDate.optional(),
    notes,
    // Optional here (unlike create): omitting it leaves the stored bill
    // discount alone, so a header-only edit cannot silently reprice the sale.
    discountPercent: discountPercent.optional(),
    items: z
      .array(saleItemUpdateSchema)
      .min(1, { message: "A sale must keep at least one item." })
      .max(100, { message: "A sale can hold at most 100 lines." })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export const saleListQuerySchema = z.object({
  customerId: id.optional(),
  dateFrom: dateBoundary.optional(),
  dateTo: dateBoundary.optional(),
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

export type SaleCreateInput = z.infer<typeof saleCreateSchema>;
export type SaleUpdateInput = z.infer<typeof saleUpdateSchema>;
export type SaleListQuery = z.infer<typeof saleListQuerySchema>;
