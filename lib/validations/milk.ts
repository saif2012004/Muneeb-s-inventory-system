import { z } from "zod";

import { startOfKarachiDay } from "@/lib/format";

/**
 * Milk shop validation — farmers, deliveries, farmer purchases, milk sales.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS NOT A THIRD SALE MODULE
 * ---------------------------------------------------------------------------
 * Beverages and Bakery are the same screen with different nouns, which is why
 * they share `components/sales/` and `reconcileSaleLines()`. Milk is not:
 *
 *   - A MilkSale has NO line items and NO product FK. It is one row of
 *     `liters × ratePerLiter`, so there is no catalog price to snapshot and
 *     `reconcileSaleLines()` has nothing to reconcile.
 *   - The milk shop runs in BOTH directions. Deliveries are milk the owner BUYS
 *     from farmers (money out); MilkSale is milk the owner SELLS (money in).
 *     Nothing in the sale modules models the buying side.
 *
 * So these schemas are written from the business rules, not adapted from
 * `lib/validations/sales.ts`.
 */

// ---------------------------------------------------------------------------
// Column bounds
//
// Every limit below is the actual Postgres column ceiling, not a guess. Letting
// a value through validation that the column cannot hold turns a friendly 400
// into a raw Prisma error at insert time.
// ---------------------------------------------------------------------------

/** Decimal(10, 2) — money. */
const MAX_MONEY = 99_999_999.99;
/** Decimal(8, 2) — liters and per-liter rates. */
const MAX_DECIMAL_8 = 999_999.99;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * A date the owner picked is a Karachi CALENDAR DAY, not an instant.
 *
 * `yyyy-MM-dd` becomes the UTC instant of Karachi midnight on that day; a full
 * ISO string passes through untouched. This is Gotcha 4 and it bites hardest
 * here: the evening delivery is logged around 7–9pm PKT, which is still the
 * same UTC day, but "today" computed server-side with a bare `new Date()` after
 * 7pm PKT is already TOMORROW in UTC — the entry would land on the wrong day.
 */
function karachiDay(label: string) {
  return z
    .string()
    .trim()
    .min(1, { message: `${label} is required` })
    .refine(isRealDate, { message: `That ${label.toLowerCase()} isn't a valid date` })
    .transform((value) =>
      DATE_ONLY.test(value) ? startOfKarachiDay(value) : new Date(value)
    );
}

const notes = z
  .string()
  .trim()
  .max(500, { message: "Notes must be 500 characters or fewer" })
  .nullable()
  .optional();

// ---------------------------------------------------------------------------
// Farmer
// ---------------------------------------------------------------------------

const farmerName = z
  .string()
  .trim()
  .min(1, { message: "Name is required" })
  .max(60, { message: "Name must be 60 characters or fewer" });

// Loose, exactly as Customer.phone is: Pakistani numbers get written
// 0300-1234567, +92 300 1234567, or with spaces. Rejecting formats would only
// annoy the owner and buys nothing.
const phone = z
  .string()
  .trim()
  .max(30, { message: "Phone must be 30 characters or fewer" })
  .nullable()
  .optional();

const address = z
  .string()
  .trim()
  .max(200, { message: "Address must be 200 characters or fewer" })
  .nullable()
  .optional();

export const farmerCreateSchema = z.object({
  name: farmerName,
  phone,
  address,
});

/** Every field optional — an omitted field means "leave unchanged". */
export const farmerUpdateSchema = z
  .object({
    name: farmerName.optional(),
    phone,
    address,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

// ---------------------------------------------------------------------------
// Milk delivery (milk the owner BUYS from a farmer)
// ---------------------------------------------------------------------------

/**
 * A single session's litres.
 *
 * NULLABLE ON PURPOSE, and null is NOT the same as 0. "No morning delivery"
 * means the farmer did not come; "0 litres" means they came and brought
 * nothing. The column is nullable for exactly this reason and
 * `serializeLiters()` preserves the distinction across the API boundary — so
 * validation must not quietly coerce one into the other.
 *
 * Zero is allowed rather than rejected: it is a real, if unusual, record, and
 * the "did anything actually arrive" check belongs on the delivery as a whole
 * (see the refine below), not on one session in isolation.
 */
const sessionLiters = z
  .number({ message: "Litres must be a number" })
  .nonnegative({ message: "Litres can't be negative" })
  .max(MAX_DECIMAL_8, { message: "Litres is too large" })
  .nullable()
  .optional();

const ratePerLiter = z
  .number({ message: "Rate must be a number" })
  .positive({ message: "Rate must be more than 0" })
  .max(MAX_DECIMAL_8, { message: "Rate is too large" });

/**
 * Both sessions absent means the owner saved an empty form. Both-zero means the
 * same thing in practice — a delivery worth nothing, which would sit in the
 * ledger contributing a 0 line and inflating the delivery count.
 *
 * Checked on the OBJECT, not on either field, because neither field can tell on
 * its own whether the delivery is empty.
 */
function hasSomeMilk(value: {
  morningLiters?: number | null;
  eveningLiters?: number | null;
}): boolean {
  return (value.morningLiters ?? 0) + (value.eveningLiters ?? 0) > 0;
}

const EMPTY_DELIVERY_MESSAGE =
  "Enter litres for the morning, the evening, or both";

export const deliveryCreateSchema = z
  .object({
    deliveryDate: karachiDay("Delivery date"),
    morningLiters: sessionLiters,
    eveningLiters: sessionLiters,
    ratePerLiter,
    notes,
  })
  .refine(hasSomeMilk, {
    message: EMPTY_DELIVERY_MESSAGE,
    path: ["morningLiters"],
  });

/**
 * Editing a delivery.
 *
 * The empty-delivery rule can NOT be re-checked here: a PATCH that only sends
 * `{ eveningLiters: 4 }` says nothing about the morning, so this schema cannot
 * see the full picture. The route merges the patch onto the stored row and
 * checks the MERGED result with {@link isEmptyDelivery} — that is the only
 * place both halves are known.
 */
export const deliveryUpdateSchema = z
  .object({
    deliveryDate: karachiDay("Delivery date").optional(),
    morningLiters: sessionLiters,
    eveningLiters: sessionLiters,
    ratePerLiter: ratePerLiter.optional(),
    notes,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

/** The merged-row form of the rule above. Used by the PATCH route. */
export function isEmptyDelivery(value: {
  morningLiters: number | null;
  eveningLiters: number | null;
}): boolean {
  return !hasSomeMilk(value);
}

export const EMPTY_DELIVERY_ERROR = EMPTY_DELIVERY_MESSAGE;

/**
 * Quick entry: one date, one rate, many farmers.
 *
 * This is the twice-daily workflow the module exists for — the owner stands at
 * the shop with farmers arriving and needs one screen, not one form per farmer.
 * Rows carrying no milk are DROPPED by the route rather than rejected, because
 * a farmer who did not come today is the normal case on this screen, not a
 * validation failure. So there is no `hasSomeMilk` refine on the row.
 *
 * `ratePerLiter` is per row, defaulted from a single top-level control in the
 * UI: the rate is usually the same for everyone on a given day, but one farmer
 * negotiating a different rate must not force the owner out of quick entry.
 */
const quickEntryRow = z.object({
  farmerId: z.string().trim().min(1, { message: "Farmer is required" }),
  morningLiters: sessionLiters,
  eveningLiters: sessionLiters,
  ratePerLiter,
});

export const quickEntrySchema = z.object({
  deliveryDate: karachiDay("Delivery date"),
  entries: z
    .array(quickEntryRow)
    .min(1, { message: "Add at least one farmer" })
    // The shop has one owner and a handful of farmers; a payload larger than
    // this is a bug or an attack, and it would hold the single DB connection
    // inside one transaction for a long time.
    .max(100, { message: "Too many rows in one save" }),
});

// ---------------------------------------------------------------------------
// Farmer purchase (goods the farmer took, offset against what they're owed)
// ---------------------------------------------------------------------------

/**
 * Common items, offered as one-tap chips in the UI. NOT an enum: the schema
 * column is free text and the owner sells whatever they sell, so a fixed list
 * would eventually reject a real purchase. These are a shortcut, not a
 * constraint.
 */
export const COMMON_PURCHASE_ITEMS = [
  "Cow food",
  "Milk",
  "Yogurt",
  "Tea powder",
] as const;

const itemDescription = z
  .string()
  .trim()
  .min(1, { message: "Item is required" })
  .max(100, { message: "Item must be 100 characters or fewer" });

const purchaseAmount = z
  .number({ message: "Amount must be a number" })
  .positive({ message: "Amount must be more than 0" })
  .max(MAX_MONEY, { message: "Amount is too large" });

export const purchaseCreateSchema = z.object({
  purchaseDate: karachiDay("Purchase date"),
  itemDescription,
  amount: purchaseAmount,
  notes,
});

export const purchaseUpdateSchema = z
  .object({
    purchaseDate: karachiDay("Purchase date").optional(),
    itemDescription: itemDescription.optional(),
    amount: purchaseAmount.optional(),
    notes,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

// ---------------------------------------------------------------------------
// Milk sale (milk the owner SELLS to a customer)
// ---------------------------------------------------------------------------

/**
 * Sold litres are strictly positive — unlike a delivery session, where 0 can
 * mean "came empty-handed". A zero-litre sale is not a transaction.
 */
const soldLiters = z
  .number({ message: "Litres must be a number" })
  .positive({ message: "Litres must be more than 0" })
  .max(MAX_DECIMAL_8, { message: "Litres is too large" });

export const milkSaleCreateSchema = z.object({
  customerId: z.string().trim().min(1, { message: "Choose a customer" }),
  saleDate: karachiDay("Sale date"),
  liters: soldLiters,
  ratePerLiter,
  notes,
});

/**
 * `customerId` is deliberately NOT editable.
 *
 * Moving a sale to a different customer silently rewrites two ledgers at once —
 * one balance drops, another rises, and neither shows why. Recording it against
 * the wrong customer is fixed by deleting the sale and entering it again, which
 * leaves the balances obviously correct instead of quietly rearranged.
 */
export const milkSaleUpdateSchema = z
  .object({
    saleDate: karachiDay("Sale date").optional(),
    liters: soldLiters.optional(),
    ratePerLiter: ratePerLiter.optional(),
    notes,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export type FarmerCreateInput = z.infer<typeof farmerCreateSchema>;
export type FarmerUpdateInput = z.infer<typeof farmerUpdateSchema>;
export type DeliveryCreateInput = z.infer<typeof deliveryCreateSchema>;
export type QuickEntryInput = z.infer<typeof quickEntrySchema>;
export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;
export type MilkSaleCreateInput = z.infer<typeof milkSaleCreateSchema>;
