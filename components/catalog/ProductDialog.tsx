"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatSize, titleCase } from "@/lib/catalog-display";
import type { Product, ProductWriteInput } from "@/lib/hooks/use-catalog";
import { pluralizeUnit } from "@/lib/sale-catalog";
import {
  PRODUCT_SHAPES,
  PRODUCT_SIZES,
  PRODUCT_UNITS,
  QUALITY_TIERS,
} from "@/lib/validations/catalog";

/**
 * Radix Select cannot hold an empty-string value, so "not set" travels as this
 * sentinel and is converted back to null on submit. The DB stores null.
 */
const NONE = "__none__";

/**
 * Mirrors productCreateSchema in lib/validations/catalog.ts: non-empty name,
 * non-negative price, and the same enum sets. Price is a string here because
 * a number input yields a string; it is coerced and validated below.
 */
const productSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Name is required" })
    .max(60, { message: "Name must be 60 characters or fewer" }),
  price: z
    .string()
    .refine((value) => value.trim() === "" || Number.isFinite(Number(value)), {
      message: "Price must be a number",
    })
    .refine((value) => value.trim() === "" || Number(value) >= 0, {
      message: "Price cannot be negative",
    }),
  /**
   * COOLING CHARGE (Migration E) — beverages only, and BLANK IS MEANINGFUL.
   *
   * Blank submits as `null` = "this product is never chilled", so the till shows
   * no toggle for it. A typed `0` means "chilled, at no charge" and DOES show
   * one. Collapsing the two would put a chill toggle on every bun.
   */
  coolingCharge: z
    .string()
    .refine((value) => value.trim() === "" || Number.isFinite(Number(value)), {
      message: "Cooling charge must be a number",
    })
    .refine((value) => value.trim() === "" || Number(value) >= 0, {
      message: "Cooling charge cannot be negative",
    }),
  size: z.string(),
  qualityTier: z.string(),
  shape: z.string(),
  unit: z.string(),
  /**
   * SELLING UNITS (S8) — strings while typing, for the same reason price is:
   * a number input cannot represent "being typed", and a half-typed "1." is
   * NaN. Coerced on submit.
   */
  units: z.array(
    z.object({
      name: z.string(),
      baseFactor: z.string(),
      price: z.string(),
      isDefault: z.boolean(),
    })
  ),
});

type ProductValues = z.infer<typeof productSchema>;

function toNullable(value: string): string | null {
  return value === NONE ? null : value;
}

export function ProductDialog({
  open,
  onOpenChange,
  mode,
  subCategoryId,
  subCategoryName,
  categoryName,
  product,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  subCategoryId: string;
  subCategoryName: string;
  /** Which CATEGORY this product sits under — decides whether cooling shows. */
  categoryName: string;
  /** Present in edit mode; seeds the form. */
  product?: Product;
  isPending: boolean;
  onSubmit: (values: ProductWriteInput) => void;
}) {
  /**
   * Cooling is a BEVERAGES concept. Matched on the category NAME, the same
   * two-step the sale routes use, so a renamed-but-equivalent category still
   * works and a bakery product never offers a chill charge.
   */
  const isBeverage = categoryName.trim().toLowerCase() === "beverages";

  const form = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      // Empty, not "0": a field pre-filled with 0 turns "tap and type 250"
      // into "0250". Blank submits as 0 via the coercion in handleSubmit.
      price: "",
      coolingCharge: "",
      units: [],
      size: NONE,
      qualityTier: NONE,
      shape: NONE,
      unit: NONE,
    },
  });

  const unitRows = useFieldArray({ control: form.control, name: "units" });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: product?.name ?? "",
      price: product ? String(product.price) : "",
      coolingCharge:
        product?.coolingCharge === null || product?.coolingCharge === undefined
          ? ""
          : String(product.coolingCharge),
      units: (product?.units ?? []).map((unit) => ({
        name: unit.name,
        baseFactor: String(unit.baseFactor),
        price: String(unit.price),
        isDefault: unit.isDefault,
      })),
      size: product?.size ?? NONE,
      qualityTier: product?.qualityTier ?? NONE,
      shape: product?.shape ?? NONE,
      unit: product?.unit ?? NONE,
    });
  }, [open, product, form]);

  function handleSubmit(values: ProductValues) {
    onSubmit({
      name: values.name,
      subCategoryId,
      price: values.price.trim() === "" ? 0 : Number(values.price),
      // Blank -> null ("never chilled"), never 0. See the schema above.
      coolingCharge:
        values.coolingCharge.trim() === "" ? null : Number(values.coolingCharge),
      /**
       * REPLACE-ALL, and rows with no name are dropped rather than sent — an
       * empty row is one the owner started and abandoned, not a unit.
       */
      units: values.units
        .filter((unit) => unit.name.trim() !== "")
        .map((unit) => ({
          name: unit.name.trim(),
          baseFactor: Number(unit.baseFactor) || 1,
          price: Number(unit.price) || 0,
          isDefault: unit.isDefault,
        })),
      size: toNullable(values.size),
      qualityTier: toNullable(values.qualityTier),
      shape: toNullable(values.shape),
      unit: toNullable(values.unit),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add product" : "Edit product"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? `New product in ${subCategoryName}.`
              : `Editing in ${subCategoryName}. Price is edited inline in the table.`}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="e.g. Pepsi 1.5L"
                      autoComplete="off"
                      className="h-11 rounded-lg"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Price only on create. Editing an existing price is the inline
                editor's job, so there is one obvious way to do it. */}
            {mode === "create" ? (
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price (PKR)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="decimal"
                        placeholder="0"
                        className="h-11 rounded-lg tabular-nums"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/* COOLING CHARGE — beverages only (the owner's instruction), and
                on BOTH create and edit, unlike price. Price has an inline
                editor in the table; this does not, so the dialog is the only
                place it can be set. */}
            {isBeverage ? (
              <FormField
                control={form.control}
                name="coolingCharge"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cooling charge (PKR per unit)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="decimal"
                        placeholder="Leave blank if never chilled"
                        className="h-11 rounded-lg tabular-nums"
                      />
                    </FormControl>
                    <p className="text-sm text-zinc-500">
                      Added per unit when the sale is marked chilled. Leave blank
                      and no chill option appears on the bill.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/* SELLING UNITS (S8). Eggs sell as dozen/tray/peti and beverages as
                bottle/pet, all drawing on ONE stock pool — so a unit says how
                many BASE units it contains, and that is what stock moves by.
                Left empty, the product simply sells one base unit at a time. */}
            <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-900">Selling units</p>
                  <p className="text-xs text-zinc-500">
                    Stock is counted in{" "}
                    {form.getValues("unit") !== NONE
                      ? pluralizeUnit(form.getValues("unit"), 2)
                      : "single units"}
                    .
                    A pack takes that many out of the same pool.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg"
                  onClick={() =>
                    unitRows.append({
                      name: "",
                      baseFactor: "",
                      price: "",
                      isDefault: unitRows.fields.length === 0,
                    })
                  }
                >
                  Add unit
                </Button>
              </div>

              {unitRows.fields.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  None — sold one at a time.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_5rem_6rem_2.75rem] gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    <span>Unit</span>
                    <span>Contains</span>
                    <span>Price</span>
                    <span className="sr-only">Remove</span>
                  </div>
                  {unitRows.fields.map((row, index) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1fr_5rem_6rem_2.75rem] gap-2"
                    >
                      <Input
                        {...form.register(`units.${index}.name`)}
                        placeholder="dozen"
                        className="h-11 rounded-lg"
                      />
                      <Input
                        {...form.register(`units.${index}.baseFactor`)}
                        inputMode="decimal"
                        placeholder="12"
                        className="h-11 rounded-lg tabular-nums"
                      />
                      <Input
                        {...form.register(`units.${index}.price`)}
                        inputMode="decimal"
                        placeholder="200"
                        className="h-11 rounded-lg tabular-nums"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="size-11 rounded-lg p-0 text-zinc-400 hover:text-rose-600"
                        onClick={() => unitRows.remove(index)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        <span className="sr-only">Remove unit {index + 1}</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                form={form}
                name="size"
                label="Size"
                options={PRODUCT_SIZES.map((value) => ({
                  value,
                  label: formatSize(value),
                }))}
              />
              {/* NO DISCOUNT FIELD, AND NOTHING BEHIND ONE. Removed when
                  discount became a sale-time percentage: putting it back would
                  let the owner recreate the "Pepsi 1.5L (30% off)" variant rows
                  that were deleted, and the same bottle would once again be two
                  products. A discount belongs to a bill — it is snapshotted on
                  SaleItem.discountPercent, so an old bill keeps showing the deal
                  actually struck. Product.discountPercent is gone entirely: the
                  column was dropped 2026-08-10 (CHECKLIST #9). */}
              <SelectField
                form={form}
                name="qualityTier"
                label="Quality"
                options={QUALITY_TIERS.map((value) => ({
                  value,
                  label: titleCase(value),
                }))}
              />
              <SelectField
                form={form}
                name="shape"
                label="Shape"
                options={PRODUCT_SHAPES.map((value) => ({
                  value,
                  label: titleCase(value),
                }))}
              />
              <SelectField
                form={form}
                name="unit"
                label="Unit"
                options={PRODUCT_UNITS.map((value) => ({
                  value,
                  label: titleCase(value),
                }))}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-lg"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-11 rounded-lg" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                ) : null}
                {mode === "create" ? "Add product" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function SelectField({
  form,
  name,
  label,
  options,
}: {
  form: ReturnType<typeof useForm<ProductValues>>;
  /**
   * Only the STRING fields. `keyof ProductValues` used to be equivalent, but S8
   * added `units`, an array — and a Select cannot render one. Narrowing here
   * makes that a compile error at the call site rather than a runtime surprise.
   */
  name: {
    [K in keyof ProductValues]: ProductValues[K] extends string ? K : never;
  }[keyof ProductValues];
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="h-11 rounded-lg">
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={NONE}>Not set</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
