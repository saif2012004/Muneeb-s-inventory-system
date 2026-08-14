"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
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
      size: NONE,
      qualityTier: NONE,
      shape: NONE,
      unit: NONE,
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: product?.name ?? "",
      price: product ? String(product.price) : "",
      coolingCharge:
        product?.coolingCharge === null || product?.coolingCharge === undefined
          ? ""
          : String(product.coolingCharge),
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
  name: keyof ProductValues;
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
