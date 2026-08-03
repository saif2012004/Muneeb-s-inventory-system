"use client";

import { Trash2 } from "lucide-react";
import { useWatch, type UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductPicker } from "@/components/beverages/ProductPicker";
import type { BeverageBrandGroup, BeverageOption } from "@/lib/beverage-catalog";
import { formatPKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  previewLineTotal,
  type SaleFormValues,
} from "@/lib/validations/beverage-sale-form";

type SaleForm = UseFormReturn<SaleFormValues, unknown, unknown>;

/**
 * One line of the sale: product, quantity, unit price, live total.
 *
 * The unit price is PRE-FILLED from the catalog but stays EDITABLE. That is not
 * a convenience — every seeded product ships at price 0, so without an editable
 * price the owner could not record a single real sale until they had gone
 * through the whole catalog. What they type here is sent as an explicit
 * `unitPrice` and the server snapshots that value verbatim (Gotcha 5).
 */
export function LineItemRow({
  form,
  index,
  groups,
  optionsById,
  onRemove,
  canRemove,
}: {
  form: SaleForm;
  index: number;
  groups: BeverageBrandGroup[];
  optionsById: Map<string, BeverageOption>;
  onRemove: () => void;
  canRemove: boolean;
}) {
  // Subscribes this row only — typing in one line does not re-render the others.
  const row = useWatch({ control: form.control, name: `items.${index}` });

  const productId = row?.productId ?? "";
  const quantity = row?.quantity ?? "";
  const unitPrice = row?.unitPrice ?? "";

  const selected = productId ? optionsById.get(productId) : undefined;
  const lineTotal = previewLineTotal(quantity, unitPrice);

  const errors = form.formState.errors.items?.[index];
  const priceIsZero = unitPrice.trim() === "0";

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
              onSelect={(option) => {
                form.setValue(`items.${index}.productId`, option.product.id, {
                  shouldValidate: true,
                });
                // Pre-fill the catalog price, but only when the owner has not
                // already typed one — re-picking a product must never silently
                // discard a price they entered by hand.
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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`item-${index}-quantity`}>Quantity</Label>
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
            <Label htmlFor={`item-${index}-price`}>Unit price</Label>
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
            {errors?.unitPrice ? (
              <p className="text-sm text-rose-600">{errors.unitPrice.message}</p>
            ) : priceIsZero ? (
              // Not an error — selling at 0 is legal, just almost always a
              // catalog price the owner has not set yet.
              <p className="text-sm text-amber-600">
                This product has no price set yet.
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-baseline justify-between border-t border-zinc-100 pt-3">
          <span className="text-sm text-zinc-500">Line total</span>
          <span className="num text-[15px] font-semibold text-zinc-900">
            {formatPKR(lineTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}
