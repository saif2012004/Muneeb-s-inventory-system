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
