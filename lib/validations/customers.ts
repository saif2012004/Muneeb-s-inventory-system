import { z } from "zod";

/**
 * Customer validation. Customers are SHARED across beverages, bakery and milk,
 * which is why this lives at the top level rather than inside a module.
 *
 * Phase 3 only needs create + list, enough to pick a customer on a sale form.
 * The full customers hub — payments, outstanding balances, receivables — is
 * Phase 4b and is not modelled here.
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

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
