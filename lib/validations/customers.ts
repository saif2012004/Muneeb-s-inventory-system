import { z } from "zod";

import { startOfKarachiDay } from "@/lib/format";

/**
 * Customer validation. Customers are SHARED across beverages, bakery and milk,
 * which is why this lives at the top level rather than inside a module.
 *
 * Phase 3 added create + list, enough to pick a customer on a sale form.
 * Phase 4b extends it with edit and with payments — the money side of the
 * customer ledger.
 */

export const CUSTOMER_TYPES = ["hotel", "individual", "shop"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/** Display labels for the type selector. */
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  hotel: "Hotel",
  individual: "Individual",
  shop: "Shop",
};

const name = z
  .string()
  .trim()
  .min(1, { message: "Name is required" })
  .max(60, { message: "Name must be 60 characters or fewer" });

// Loose on purpose: Pakistani numbers get written 0300-1234567, +92 300
// 1234567, or with spaces. Rejecting formats would only annoy the owner.
const phone = z
  .string()
  .trim()
  .max(30, { message: "Phone must be 30 characters or fewer" })
  .nullable()
  .optional();

const type = z.enum(CUSTOMER_TYPES, {
  message: "Choose a customer type: hotel, individual or shop",
});

export const customerCreateSchema = z.object({ name, phone, type });

/** Every field optional — an omitted field means "leave unchanged". */
export const customerUpdateSchema = z
  .object({
    name: name.optional(),
    phone,
    type: type.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = ["cash", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  transfer: "Transfer",
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * A payment DATE is a Karachi calendar day, exactly like a sale date — see the
 * note in lib/validations/sales.ts. A `yyyy-MM-dd` input becomes the UTC
 * instant of Karachi midnight on that day; a full ISO string passes through.
 */
const paymentDate = z
  .string()
  .trim()
  .min(1, { message: "Payment date is required" })
  .refine(isRealDate, { message: "That payment date isn't a valid date" })
  .transform((value) =>
    DATE_ONLY.test(value) ? startOfKarachiDay(value) : new Date(value)
  );

/**
 * Decimal(10, 2) tops out at 99,999,999.99.
 *
 * Strictly positive: a zero payment records nothing and would just be noise in
 * the ledger, and a NEGATIVE payment would silently act as a manual debt
 * increase — a sale by another name, with no line items and no audit trail.
 * Overpayment is still expressible; it shows up as a negative balance.
 */
const amount = z
  .number({ message: "Amount must be a number" })
  .positive({ message: "Amount must be more than 0" })
  .max(99_999_999.99, { message: "Amount is too large" });

const method = z
  .enum(PAYMENT_METHODS, { message: "Choose cash or transfer" })
  .nullable()
  .optional();

const notes = z
  .string()
  .trim()
  .max(500, { message: "Notes must be 500 characters or fewer" })
  .nullable()
  .optional();

export const paymentCreateSchema = z.object({
  paymentDate,
  amount,
  method,
  notes,
});

export const paymentUpdateSchema = z
  .object({
    paymentDate: paymentDate.optional(),
    amount: amount.optional(),
    method,
    notes,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
