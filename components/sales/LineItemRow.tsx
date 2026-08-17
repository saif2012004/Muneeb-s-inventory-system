"use client";

import { Trash2 } from "lucide-react";
import { useWatch, type UseFormReturn } from "react-hook-form";

import { ProductPicker } from "@/components/sales/ProductPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPKR } from "@/lib/format";
import {
  formatQuantityWithUnit,
  quantityFieldLabel,
  unitIsInformative,
  unitPriceFieldLabel,
  type SaleBrandGroup,
  type SaleProductOption,
} from "@/lib/sale-catalog";
import { cn } from "@/lib/utils";
import { previewLineTotal, type SaleFormValues } from "@/lib/validations/sale-form";

type SaleForm = UseFormReturn<SaleFormValues, unknown, unknown>;

/**
 * One line of a sale: product, quantity, unit price, live total. Shared by
 * every sale module.
 *
 * The unit price is PRE-FILLED from the catalog but stays EDITABLE. That is not
 * a convenience — every seeded product ships at price 0, in bakery exactly as in
 * beverages, so without an editable price the owner could not record a single
 * real sale until the whole catalog had been priced. What they type is sent as
 * an explicit `unitPrice` and the server snapshots that value verbatim
 * (Gotcha 5).
 *
 * ---------------------------------------------------------------------------
 * THE QUANTITY UNIT
 * ---------------------------------------------------------------------------
 * Quantity means different things per product. Eggs are sold BY THE COTTON, so
 * "3" is three cottons, not three eggs. The unit lives on the product, so the
 * field labels itself once a product is chosen — "Quantity (cottons)" — and the
 * line total row spells the quantity out, "3 cottons". A number with no named
 * unit is a number the owner has to remember the convention for.
 */
export function LineItemRow({
  form,
  index,
  groups,
  optionsById,
  onRemove,
  canRemove,
  searchPlaceholder,
  showDiscount = true,
  priceLocked = false,
  extraUnitCost = 0,
  afterProduct = null,
  unitName = null,
}: {
  form: SaleForm;
  index: number;
  groups: SaleBrandGroup[];
  optionsById: Map<string, SaleProductOption>;
  onRemove: () => void;
  canRemove: boolean;
  searchPlaceholder?: string;
  /**
   * The UNIFIED till has NO discounts — `POST /api/sales` rejects a
   * `discountPercent` outright — so it hides this field rather than offering
   * one that cannot be honoured. Defaults to `true`, which is exactly the
   * beverages/bakery behaviour that shipped in Phases 3 and 4: those screens
   * pass nothing and are unchanged.
   */
  showDiscount?: boolean;
  /**
   * 🔒 EDIT MODE, EXISTING LINE. The price becomes read-only text.
   *
   * The server REFUSES to change an existing line's price — `reconcileSaleLines`
   * takes it from the stored snapshot or the database, never from the client
   * (CHECKLIST #7), because honouring it would let a closed bill be silently
   * re-priced. An editable box here would therefore accept a new number, save
   * happily, and change nothing: a silent no-op, which is worse for the owner
   * than not offering it. Swapping the PRODUCT is the supported way to re-price
   * a line, and the hint below says so.
   */
  priceLocked?: boolean;
  /**
   * A per-unit cost the LINE carries beyond its price — today, the cooling
   * charge (Migration E). Added to the unit price for THIS ROW'S preview so the
   * line total the owner reads is the same figure the bill total sums and the
   * server stores. Without it a chilled line would show Rs. 825 while the total
   * bar said Rs. 915, and the owner would have to work out which was lying.
   *
   * Defaults to 0, so the two per-module screens are byte-identical.
   */
  extraUnitCost?: number;
  /**
   * SELLING UNIT (Migration F) — rendered directly under the Product picker,
   * and the name of whatever it has selected.
   *
   * Two separate props for one feature, on purpose:
   *
   * - `afterProduct` is a SLOT. The picker needs the form's `setValue` and the
   *   catalog's unit rows, neither of which this shared row should learn about
   *   for the sake of one screen. It lives in the till (`UnifiedSaleForm`) and
   *   is passed in, so the two per-module screens render byte-identically by
   *   passing nothing. It sits under Product because choosing a unit REWRITES
   *   the price below it — a control that changes a field has to appear before
   *   it, not under the line total.
   *
   * - `unitName` re-labels the quantity and price fields. Once a peti is chosen
   *   the quantity is 1 PETI at 7,000 a peti, and leaving the base-unit labels
   *   showed "Quantity (eggs)" and "Price per egg" beside 7000 — which reads as
   *   Rs. 7,000 per egg. Found in browser testing, 2026-08-18.
   */
  afterProduct?: React.ReactNode;
  unitName?: string | null;
}) {
  // Subscribes this row only — typing in one line doesn't re-render the others.
  const row = useWatch({ control: form.control, name: `items.${index}` });

  const productId = row?.productId ?? "";
  const quantity = row?.quantity ?? "";
  const unitPrice = row?.unitPrice ?? "";
  const discountPercent = row?.discountPercent ?? "";

  const selected = productId ? optionsById.get(productId) : undefined;
  /**
   * The unit the LINE is priced and counted in: the chosen selling unit when
   * there is one, otherwise the product's base unit. Everything user-facing
   * below reads this, so the labels can never disagree with the price.
   *
   * `unitIsInformative` is bypassed for a selling unit — a pack name is always
   * worth showing. It exists to suppress "12 pieces"/"3 bottles", where the
   * unit only repeats what the product name already said; "1 peti" is the whole
   * point of the line.
   */
  const unit = unitName || selected?.product.unit || null;
  const pricePerUnit = String((Number(unitPrice) || 0) + extraUnitCost);
  const lineTotal = previewLineTotal(quantity, pricePerUnit, discountPercent);
  /**
   * What the line WOULD have been without its discount, shown struck through
   * beside the total. The discount is the thing the owner is most likely to
   * mistype (a stray 0 turns 5% into 50%), and a bare "Rs. 465" gives them
   * nothing to check it against — "Rs. 930 → Rs. 465" is immediately wrong-looking.
   */
  const undiscountedTotal = previewLineTotal(quantity, pricePerUnit);
  const hasDiscount = lineTotal !== undiscountedTotal;

  const errors = form.formState.errors.items?.[index];
  const priceIsZero = unitPrice.trim() === "0";

  // Only worth spelling out when the unit adds information — "3 cottons" earns
  // its place, "12 pieces" just repeats what the product already said.
  const parsedQuantity = Number(quantity);
  const quantitySummary =
    selected &&
    (Boolean(unitName) || unitIsInformative(unit)) &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0
      ? formatQuantityWithUnit(parsedQuantity, unit, unitName)
      : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
          Item {index + 1}
        </span>

        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="-mr-1 -mt-1 flex size-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:pointer-events-none disabled:opacity-40"
        >
          <Trash2 className="size-4" aria-hidden />
          <span className="sr-only">Remove item {index + 1}</span>
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`item-${index}-product`}>Product</Label>
          <div id={`item-${index}-product`}>
            <ProductPicker
              groups={groups}
              selected={selected}
              invalid={Boolean(errors?.productId)}
              searchPlaceholder={searchPlaceholder}
              onSelect={(option) => {
                form.setValue(`items.${index}.productId`, option.product.id, {
                  shouldValidate: true,
                });
                // Pre-fill the catalog price, but only when the owner hasn't
                // already typed one — re-picking must never silently discard a
                // price they entered by hand.
                const current = form.getValues(`items.${index}.unitPrice`);
                if (current.trim() === "") {
                  form.setValue(
                    `items.${index}.unitPrice`,
                    String(option.product.price),
                    { shouldValidate: false }
                  );
                }
              }}
            />
          </div>
          {errors?.productId ? (
            <p className="text-sm text-rose-600">{errors.productId.message}</p>
          ) : null}
          {afterProduct}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            {/* Names the unit as soon as one is known: "Quantity (cottons)". */}
            <Label htmlFor={`item-${index}-quantity`}>
              {unitName ? `Quantity (${unitName})` : quantityFieldLabel(unit)}
            </Label>
            <Input
              id={`item-${index}-quantity`}
              // Design System: numeric inputs use inputMode="decimal" so the
              // phone opens a number pad instead of the full keyboard.
              inputMode="decimal"
              autoComplete="off"
              className={cn(
                "num h-11 rounded-lg",
                errors?.quantity && "border-rose-400 focus-visible:ring-rose-400"
              )}
              {...form.register(`items.${index}.quantity`)}
            />
            {errors?.quantity ? (
              <p className="text-sm text-rose-600">{errors.quantity.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`item-${index}-price`}>
              {unitName ? `Price per ${unitName}` : unitPriceFieldLabel(unit)}
            </Label>
            {priceLocked ? (
              <>
                {/* Read-only, not disabled-looking: this IS the price that was
                    charged, and the owner should be able to read it plainly. */}
                <p
                  id={`item-${index}-price`}
                  className="num flex h-11 items-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700"
                >
                  {formatPKR(Number(unitPrice) || 0)}
                </p>
                <p className="text-sm text-zinc-500">
                  The price charged on this bill. Change the product to re-price
                  the line.
                </p>
              </>
            ) : (
              <Input
                id={`item-${index}-price`}
                inputMode="decimal"
                autoComplete="off"
                className={cn(
                  "num h-11 rounded-lg",
                  errors?.unitPrice && "border-rose-400 focus-visible:ring-rose-400"
                )}
                {...form.register(`items.${index}.unitPrice`)}
              />
            )}
            {priceLocked ? null : errors?.unitPrice ? (
              <p className="text-sm text-rose-600">{errors.unitPrice.message}</p>
            ) : priceIsZero ? (
              // Not an error — selling at 0 is legal, just almost always a
              // catalog price the owner hasn't set yet.
              <p className="text-sm text-amber-600">
                This product has no price set yet.
              </p>
            ) : null}
          </div>
        </div>

        {/* Line discount. Its own row rather than a third column: at 360px three
            numeric fields would each be under the 44px touch target, and this is
            the field most owners leave blank. */}
        {showDiscount ? (
        <div className="space-y-1.5">
          <Label htmlFor={`item-${index}-discount`}>Discount % (optional)</Label>
          <Input
            id={`item-${index}-discount`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            className={cn(
              "num h-11 rounded-lg",
              errors?.discountPercent &&
                "border-rose-400 focus-visible:ring-rose-400"
            )}
            {...form.register(`items.${index}.discountPercent`)}
          />
          {errors?.discountPercent ? (
            <p className="text-sm text-rose-600">
              {errors.discountPercent.message}
            </p>
          ) : null}
        </div>
        ) : null}

        <div className="flex items-baseline justify-between border-t border-zinc-100 pt-3">
          <span className="num text-sm text-zinc-500">
            {/* Spells the unit out: "3 cottons", "12 pieces". */}
            {quantitySummary ? `${quantitySummary} · Line total` : "Line total"}
          </span>
          <span className="num text-[15px] font-semibold text-zinc-900">
            {hasDiscount ? (
              <span className="mr-2 font-normal text-zinc-400 line-through">
                {formatPKR(undiscountedTotal)}
              </span>
            ) : null}
            {formatPKR(lineTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}
