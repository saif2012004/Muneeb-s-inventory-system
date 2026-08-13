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
export function previewLineTotal(
  quantity: string,
  unitPrice: string,
  discountPercent = ""
): number {
  const qty = toNumber(quantity) ?? 0;
  const price = toNumber(unitPrice) ?? 0;
  if (qty <= 0 || price < 0) return 0;
  // Clamped rather than rejected: a half-typed "1000" in the discount box
  // shouldn't blank the whole preview or show a negative line.
  const discount = Math.min(Math.max(toNumber(discountPercent) ?? 0, 0), 100);
  return round2(qty * price * (1 - discount / 100));
}

/**
 * The whole-bill discount applied to a subtotal, for the live preview only.
 *
 * Mirrors `applySaleDiscount` in lib/sales.ts — line discounts first, then this
 * on their subtotal. The server recomputes both on Decimal and its answer is the
 * one that gets stored; this exists so the owner can watch the bill add up.
 */
export function previewSaleTotal(
  subtotal: number,
  discountPercent: string
): number {
  const discount = Math.min(Math.max(toNumber(discountPercent) ?? 0, 0), 100);
  return round2(subtotal * (1 - discount / 100));
}

/**
 * 2dp, half-up, matching the server's Decimal rounding closely enough for a
 * preview. `Number.EPSILON` nudges the classic float case: 25.124999999999996
 * would otherwise round DOWN to 25.12 while the server stores 25.13, and the
 * owner would watch the total change by a paisa on save.
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The quantity field, in the two forms the app genuinely needs.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO, AND WHY THE INTEGER ONE MUST STAY STRICT
 * ---------------------------------------------------------------------------
 * `"integer"` mirrors the per-module server schema (`lib/validations/sales.ts`,
 * `.int()`): 2.5 bottles of Pepsi is a typo, and `/api/beverages/sales` rejects
 * it with a 400. A form that let it through would only earn the owner a
 * round-trip error.
 *
 * `"decimal"` mirrors the UNIFIED server schema: milk sells in litres and 12.5
 * is an ordinary quantity (Migrations C and D exist for exactly this). Two
 * decimal places, matching `SaleItem.quantity numeric(10,2)`, so what validates
 * is what gets stored.
 *
 * They disagree ON PURPOSE — same reason the two server schemas do. Do not
 * "consolidate" them into one loose field.
 */
function quantityField(mode: "integer" | "decimal") {
  return z
    .string()
    .trim()
    .min(1, { message: "Enter a quantity" })
    .transform((value, ctx) => {
      const parsed = toNumber(value);
      if (parsed === null) {
        ctx.addIssue({ code: "custom", message: "Quantity must be a number" });
        return z.NEVER;
      }
      if (mode === "integer" && !Number.isInteger(parsed)) {
        ctx.addIssue({ code: "custom", message: "Quantity must be a whole number" });
        return z.NEVER;
      }
      if (mode === "integer" && parsed < 1) {
        ctx.addIssue({ code: "custom", message: "Quantity must be at least 1" });
        return z.NEVER;
      }
      // Decimal: anything above zero is real — half a litre is a sale. Zero is
      // not: a zero line decrements no stock while still printing on the bill.
      if (mode === "decimal" && parsed <= 0) {
        ctx.addIssue({
          code: "custom",
          message: "Quantity must be greater than zero",
        });
        return z.NEVER;
      }
      if (mode === "decimal" && Math.round(parsed * 100) !== parsed * 100) {
        ctx.addIssue({
          code: "custom",
          message: "Quantity can have at most 2 decimal places",
        });
        return z.NEVER;
      }
      if (parsed > MAX_QUANTITY) {
        ctx.addIssue({ code: "custom", message: "Quantity is too large" });
        return z.NEVER;
      }
      return parsed;
    });
}

const quantity = quantityField("integer");

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

/**
 * A discount percentage as typed. EMPTY MEANS NO DISCOUNT — the common case is
 * no discount at all, so requiring a "0" in every box would be daily friction
 * for the sake of the rare case. Blank transforms to 0.
 */
const discountPercent = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return 0;
    const parsed = toNumber(value);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Discount must be a number" });
      return z.NEVER;
    }
    if (parsed < 0) {
      ctx.addIssue({ code: "custom", message: "Discount cannot be negative" });
      return z.NEVER;
    }
    if (parsed > 100) {
      ctx.addIssue({ code: "custom", message: "Discount cannot exceed 100%" });
      return z.NEVER;
    }
    // Matches the DECIMAL(5,2) column, so what validates is what gets stored.
    return Math.round(parsed * 100) / 100;
  });

export const saleLineSchema = z.object({
  productId: z.string().min(1, { message: "Choose a product" }),
  quantity,
  unitPrice,
  discountPercent,
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
  /** Whole-bill discount, applied to the subtotal of discounted lines. */
  discountPercent,
  items: z
    .array(saleLineSchema)
    .min(1, { message: "Add at least one item to the sale." })
    .max(100, { message: "A sale can hold at most 100 lines." }),
});

/**
 * THE UNIFIED TILL's schema (S4.2) — one bill, any shop.
 *
 * Two differences from the per-module one, both matching the unified server
 * schema so the form and the endpoint cannot disagree:
 *
 *   1. QUANTITY IS DECIMAL — 12.5 litres of milk is an ordinary line.
 *   2. NO DISCOUNTS ANYWHERE. `POST /api/sales` is `.strict()`, so sending a
 *      `discountPercent` is a 400, not a silent drop. The field survives in FORM
 *      STATE (always "") purely so `LineItemRow` can stay one shared component —
 *      it is never rendered on this screen and never sent.
 */
export const unifiedSaleFormSchema = z.object({
  customerId: z.string().min(1, { message: "Choose a customer" }),
  saleDate: z.date({ message: "Choose a date" }),
  notes: z
    .string()
    .trim()
    .max(500, { message: "Notes must be 500 characters or fewer" })
    .optional(),
  /**
   * PRESENT IN FORM STATE, NEVER RENDERED AND NEVER SENT — always "".
   *
   * It exists so `SaleFormValues` and `UnifiedSaleFormValues` stay structurally
   * IDENTICAL, which is what lets `LineItemRow` be one shared component instead
   * of two, with no `as unknown as` cast at the call site to paper over a
   * mismatch. The same reasoning keeps the per-line `discountPercent` here.
   *
   * The unified endpoint is `.strict()`: sending this field is a 400. The till
   * builds its payload field-by-field and simply never includes it.
   */
  discountPercent,
  items: z
    .array(
      z.object({
        productId: z.string().min(1, { message: "Choose a product" }),
        quantity: quantityField("decimal"),
        unitPrice,
        discountPercent,
      })
    )
    .min(1, { message: "Add at least one item to the sale." })
    .max(100, { message: "A sale can hold at most 100 lines." }),
});

/** What the inputs bind to (strings). */
export type SaleFormValues = z.input<typeof newSaleFormSchema>;
/** What `handleSubmit` receives (numbers). */
export type SaleFormOutput = z.output<typeof newSaleFormSchema>;

/** Same shape as {@link SaleFormValues} — deliberately, so `LineItemRow` is shared. */
export type UnifiedSaleFormValues = z.input<typeof unifiedSaleFormSchema>;
export type UnifiedSaleFormOutput = z.output<typeof unifiedSaleFormSchema>;

/** A fresh, empty line. `unitPrice` is filled in when a product is chosen. */
export function emptySaleLine(): SaleFormValues["items"][number] {
  return { productId: "", quantity: "1", unitPrice: "", discountPercent: "" };
}
