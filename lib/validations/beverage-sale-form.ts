import { z } from "zod";

/**
 * The NEW-SALE FORM's schema. Mirrors the server rules in
 * lib/validations/sales.ts so the owner sees an inline error instead of a
 * round-trip, but the server stays the authority — this never replaces it.
 *
 * ---------------------------------------------------------------------------
 * WHY QUANTITY AND PRICE ARE STRINGS IN FORM STATE
 * ---------------------------------------------------------------------------
 * A number input that holds a number cannot represent "being typed". Clearing
 * the field gives `""`, which `valueAsNumber` turns into `NaN`, and a half-typed
 * "1." is not a number either. Both make React re-render the field out from
 * under the owner mid-keystroke — on a cheap Android keyboard that reads as the
 * app fighting them.
 *
 * So form state holds the raw string, and the schema TRANSFORMS to numbers on
 * submit. `SaleFormValues` is what the inputs bind to; `SaleFormOutput` is what
 * `handleSubmit` receives.
 */

const MAX_MONEY = 99_999_999.99;
const MAX_QUANTITY = 1_000_000;

/** Blank, or anything that isn't a finite number. */
function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Live line total while typing. Deliberately lenient — a half-typed field shows
 * as 0 rather than an error, because the owner has not finished yet. Validation
 * happens on submit; this is only the preview.
 *
 * The SERVER recomputes every total on submit (Gotcha 2: money math is
 * server-side). This exists to answer "what am I charging?" as they type,
 * nothing more.
 */
export function previewLineTotal(quantity: string, unitPrice: string): number {
  const qty = toNumber(quantity) ?? 0;
  const price = toNumber(unitPrice) ?? 0;
  if (qty <= 0 || price < 0) return 0;
  return qty * price;
}

const quantity = z
  .string()
  .trim()
  .min(1, { message: "Enter a quantity" })
  .transform((value, ctx) => {
    const parsed = toNumber(value);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Quantity must be a number" });
      return z.NEVER;
    }
    if (!Number.isInteger(parsed)) {
      ctx.addIssue({ code: "custom", message: "Quantity must be a whole number" });
      return z.NEVER;
    }
    if (parsed < 1) {
      ctx.addIssue({ code: "custom", message: "Quantity must be at least 1" });
      return z.NEVER;
    }
    if (parsed > MAX_QUANTITY) {
      ctx.addIssue({ code: "custom", message: "Quantity is too large" });
      return z.NEVER;
    }
    return parsed;
  });

const unitPrice = z
  .string()
  .trim()
  .min(1, { message: "Enter a price" })
  .transform((value, ctx) => {
    const parsed = toNumber(value);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Price must be a number" });
      return z.NEVER;
    }
    if (parsed < 0) {
      ctx.addIssue({ code: "custom", message: "Price cannot be negative" });
      return z.NEVER;
    }
    if (parsed > MAX_MONEY) {
      ctx.addIssue({ code: "custom", message: "Price is too large" });
      return z.NEVER;
    }
    return parsed;
  });

export const saleLineSchema = z.object({
  productId: z.string().min(1, { message: "Choose a product" }),
  quantity,
  unitPrice,
});

export const newSaleFormSchema = z.object({
  customerId: z.string().min(1, { message: "Choose a customer" }),
  // A Date from the Calendar. Converted to a "yyyy-MM-dd" key on submit.
  saleDate: z.date({ message: "Choose a date" }),
  notes: z
    .string()
    .trim()
    .max(500, { message: "Notes must be 500 characters or fewer" })
    .optional(),
  items: z
    .array(saleLineSchema)
    .min(1, { message: "Add at least one item to the sale." })
    .max(100, { message: "A sale can hold at most 100 lines." }),
});

/** What the inputs bind to (strings). */
export type SaleFormValues = z.input<typeof newSaleFormSchema>;
/** What `handleSubmit` receives (numbers). */
export type SaleFormOutput = z.output<typeof newSaleFormSchema>;

/** A fresh, empty line. `unitPrice` is filled in when a product is chosen. */
export function emptySaleLine(): SaleFormValues["items"][number] {
  return { productId: "", quantity: "1", unitPrice: "" };
}
