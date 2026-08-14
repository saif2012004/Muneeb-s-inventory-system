"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Loader2, LogIn, Plus, Printer, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { CustomerCombobox } from "@/components/sales/CustomerCombobox";
import { LineItemRow } from "@/components/sales/LineItemRow";
import { SaleDatePicker } from "@/components/sales/SaleDatePicker";
import { StockBlockAlert } from "@/components/sales/StockBlockAlert";
import { AnimatedMoney } from "@/components/shared/AnimatedMoney";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, redirectToLogin, type StockShortfall } from "@/lib/api-client";
import { formatPKR, karachiToday, toDateKey } from "@/lib/format";
import { useProducts } from "@/lib/hooks/use-catalog";
import { useCustomers } from "@/lib/hooks/use-customers";
import {
  useCreateUnifiedSale,
  useUpdateUnifiedSale,
  type UnifiedSaleDetail,
} from "@/lib/hooks/use-unified-sales";
import { enterUp, lineItemInOut } from "@/lib/motion";
import { groupUnifiedSaleProducts, indexSaleProducts } from "@/lib/sale-catalog";
import {
  emptyUnifiedSaleLine,
  previewLineTotal,
  unifiedSaleFormSchema,
  type UnifiedSaleFormOutput,
  type UnifiedSaleFormValues,
} from "@/lib/validations/sale-form";

/**
 * The chill toggle for one line (Migration E).
 *
 * ---------------------------------------------------------------------------
 * A TOGGLE, AND NOTHING ELSE — the owner's instruction
 * ---------------------------------------------------------------------------
 * "no field when making bill. during bill just add a toggle... the cooling
 * charges has to be added from the catalog". So the bill shows whether the item
 * was chilled and what that adds; the AMOUNT is set once, in the catalog, and
 * the server reads it from there. There is no rate box here to disagree with it.
 *
 * It appears ONLY for a product that has a cooling charge — null means "never
 * chilled" and a bun must not offer one.
 *
 * It lives here rather than inside `LineItemRow` so that shared component (used
 * by the two per-module screens as well) needs no new required field.
 */
function ChillToggle({
  form,
  index,
  optionsById,
  locked,
}: {
  form: ReturnType<typeof useForm<UnifiedSaleFormValues, unknown, UnifiedSaleFormOutput>>;
  index: number;
  optionsById: Map<string, { product: { coolingCharge: number | null } }>;
  locked: boolean;
}) {
  const productId = useWatch({ control: form.control, name: `items.${index}.productId` });
  const chilled = useWatch({ control: form.control, name: `items.${index}.chilled` });
  const charge = productId ? optionsById.get(productId)?.product.coolingCharge : null;

  if (charge === null || charge === undefined) return null;

  // On an EXISTING line the server keeps the stored rate, so the toggle would
  // be a no-op. State is shown, not offered — same stance as the locked price.
  if (locked) {
    return chilled ? (
      <p className="-mt-1 px-4 pb-3 text-sm text-zinc-500">
        Chilled · {formatPKR(charge)} per unit was added to this line.
      </p>
    ) : null;
  }

  return (
    <label className="-mt-1 flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-4 pb-3">
      <span className="text-sm text-zinc-600">
        Chilled{" "}
        <span className="num text-zinc-400">
          (+{formatPKR(charge)} per unit)
        </span>
      </span>
      <Switch
        checked={chilled ?? false}
        onCheckedChange={(next) =>
          form.setValue(`items.${index}.chilled`, next, { shouldDirty: true })
        }
      />
    </label>
  );
}

/**
 * THE UNIFIED TILL — one bill, any product from any shop.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN COMPONENT AND NOT `NewSaleForm` WITH FLAGS
 * ---------------------------------------------------------------------------
 * The shared-components rule in CLAUDE.md says parameterise rather than fork,
 * and every PRIMITIVE here is shared, unchanged: `CustomerCombobox`,
 * `SaleDatePicker`, `ProductPicker` (through `LineItemRow`), `StockBlockAlert`,
 * `AnimatedMoney`, the motion vocabulary. What is NOT shared is the assembly,
 * for three reasons that no flag removes:
 *
 *   1. A DIFFERENT MUTATION LAYER. `NewSaleForm` calls `useCreateSale(module)`
 *      directly; this calls `useCreateUnifiedSale()`. Hooks cannot be selected
 *      from a plain config object without restructuring the shipped form.
 *   2. NO DISCOUNTS AT ALL — no line field, no bill field, no discount rows in
 *      the summary. `POST /api/sales` is `.strict()` and 400s on one.
 *   3. NO `SaleModule`. That config's `key` is a ModuleKey and it carries an
 *      export type and a module accent; a cross-module bill has none of those.
 *      Forcing a fourth row into it is the same mistake `lib/milk-sales.ts`
 *      documents refusing.
 *
 * The alternative — refactoring `NewSaleForm` — would put two shipped,
 * browser-verified money screens at risk to save one screen's shell.
 *
 * ACCENT IS ZINC, deliberately. The Design System forbids mixing module accents
 * on one screen, and a bill that may hold beverage, bakery and milk lines has no
 * single accent to claim.
 */
export function UnifiedSaleForm({ sale }: { sale?: UnifiedSaleDetail }) {
  /**
   * EDIT MODE (CHECKLIST #8) when a `sale` is passed.
   *
   * The same form, because it is the same bill: customer, date, lines, total.
   * Three things differ, and each follows a server rule rather than a taste:
   *
   *   - the CUSTOMER is fixed. Moving a bill to another customer moves money
   *     between two people's ledgers; that is a different operation from
   *     correcting a line, and the API does not accept it.
   *   - an existing line's PRICE is READ-ONLY (see `priceLocked`).
   *   - `unitPrice` is sent ONLY for new lines, so nothing is submitted that the
   *     server would silently ignore.
   */
  const isEdit = sale !== undefined;
  const reduceMotion = useReducedMotion();
  const [justSaved, setJustSaved] = useState<{ id: string; total: number } | null>(
    null
  );
  /**
   * The last stock refusal, kept so the owner can restock and retry WITHOUT
   * losing the bill they have already typed. Cleared on every fresh submit.
   */
  const [stockBlock, setStockBlock] = useState<{
    message: string;
    shortfalls: StockShortfall[];
  } | null>(null);

  const customersQuery = useCustomers();
  // Active products only: the API refuses a deactivated product, so offering
  // one would only produce an error the owner cannot act on.
  const productsQuery = useProducts(false);
  const createSale = useCreateUnifiedSale();
  const updateSale = useUpdateUnifiedSale();
  const isPending = createSale.isPending || updateSale.isPending;

  const form = useForm<UnifiedSaleFormValues, unknown, UnifiedSaleFormOutput>({
    resolver: zodResolver(unifiedSaleFormSchema),
    defaultValues: {
      customerId: sale?.customer.id ?? "",
      saleDate: sale ? new Date(sale.saleDate) : karachiToday(),
      notes: sale?.notes ?? "",
      // Never rendered, never sent — it keeps the form value shape identical to
      // the per-module one so `LineItemRow` stays shared. See the schema.
      discountPercent: "",
      items: sale
        ? sale.items.map((item) => ({
            // The stored line's id rides in the form as a hidden field so the
            // reconciler can match by IDENTITY. Matching by array position is
            // what silently re-prices the wrong line when one is deleted from
            // the middle — the trap CLAUDE.md calls out on reconcileSaleLines.
            id: item.id,
            productId: item.productId,
            quantity: String(item.quantity),
            unitPrice: String(item.unitPrice),
            discountPercent: "",
            // Stored lines keep their charge and cannot toggle it — the server
            // ignores the flag for them. Shown as text beneath the row instead.
            chilled: item.coolingRate > 0,
          }))
        : [emptyUnifiedSaleLine()],
    },
    mode: "onTouched",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  /**
   * EVERY product, from every shop — no category filter. That is the whole
   * point of this screen, and it is also why the picker headings carry the
   * category name (see `groupUnifiedSaleProducts`).
   *
   * The server still decides: `loadUnifiedSaleProducts` resolves each line's
   * module from its product's category and 409s on a product whose category
   * backs no module.
   */
  const saleGroups = useMemo(
    () => groupUnifiedSaleProducts(productsQuery.data ?? []),
    [productsQuery.data]
  );
  const optionsById = useMemo(() => indexSaleProducts(saleGroups), [saleGroups]);

  // Watched rather than derived from `fields`, which is a render-time snapshot
  // and would lag every keystroke.
  const watchedItems = useWatch({ control: form.control, name: "items" });

  /**
   * The running total. NO discount stage — with none, the bill total IS the sum
   * of the line totals, which is the same invariant the server relies on
   * (`netLineTotal === lineTotal`, `totalAmount === Σ netLineTotal`).
   *
   * The server recomputes every figure on Decimal and its answer is what gets
   * stored; this exists so the owner can watch the bill add up.
   */
  /**
   * A line's per-unit cooling charge, for the preview only. The SERVER decides
   * the real one from the catalog row; this exists so the total bar agrees with
   * what the owner is about to be charged.
   */
  const coolingFor = (item: { productId?: string; chilled?: boolean } | undefined) => {
    if (!item?.chilled || !item.productId) return 0;
    return optionsById.get(item.productId)?.product.coolingCharge ?? 0;
  };

  const runningTotal = (watchedItems ?? []).reduce(
    (total, item) =>
      total +
      previewLineTotal(
        item?.quantity ?? "",
        String((Number(item?.unitPrice) || 0) + coolingFor(item))
      ),
    0
  );

  const customers = customersQuery.data ?? [];

  // ------------------------------------------------------------------
  // Session / error states
  // ------------------------------------------------------------------

  const sessionExpired =
    (customersQuery.error instanceof ApiError &&
      customersQuery.error.isSessionExpired) ||
    (productsQuery.error instanceof ApiError &&
      productsQuery.error.isSessionExpired);

  if (sessionExpired) {
    return (
      <>
        <PageHeader title="New sale" accent="zinc" />
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to record a sale."
          accent="zinc"
          action={
            <Button
              className="h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800"
              onClick={redirectToLogin}
            >
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  const loadError = customersQuery.error ?? productsQuery.error;
  if (loadError) {
    return (
      <>
        <PageHeader title="New sale" accent="zinc" />
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load the form"
          description={
            loadError instanceof ApiError ? loadError.message : "Something went wrong."
          }
          accent="zinc"
          action={
            <Button
              className="h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800"
              onClick={() => {
                customersQuery.refetch();
                productsQuery.refetch();
              }}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  // ------------------------------------------------------------------
  // Submit
  // ------------------------------------------------------------------

  /**
   * One error path for create and edit — the failures are identical and the
   * owner should not get two different behaviours for the same problem.
   */
  function handleSubmitError(error: unknown) {
    if (error instanceof ApiError && error.isSessionExpired) {
      toast.error(error.message);
      redirectToLogin();
      return;
    }
    /**
     * Insufficient stock is NOT a toast. A toast disappears, and this one
     * carries the numbers the owner needs plus the controls to fix them — so it
     * renders into the form and stays until resolved.
     */
    if (error instanceof ApiError && error.isBlockedByStock) {
      setStockBlock({ message: error.message, shortfalls: error.shortBy });
      return;
    }
    toast.error(
      error instanceof ApiError
        ? error.message
        : isEdit
          ? "Couldn't update the sale."
          : "Couldn't record the sale."
    );
  }

  const onSubmit = form.handleSubmit(
    (values) => {
      // A retry starts clean: the alert must never outlive the problem.
      setStockBlock(null);

      if (isEdit) {
        updateSale.mutate(
          {
            id: sale.id,
            saleDate: toDateKey(values.saleDate),
            notes: values.notes || null,
            /**
             * `unitPrice` is sent ONLY for a NEW line. For an existing one the
             * server ignores it by design (CHECKLIST #7), so submitting it would
             * be sending a value we know cannot take effect. The form does not
             * offer it either — the field is read-only.
             */
            items: values.items.map((item) => ({
              // A stored line sends neither price nor chill flag: the server
              // keeps both, so submitting them would be sending values we know
              // cannot take effect.
              ...(item.id
                ? { id: item.id }
                : { unitPrice: item.unitPrice, chilled: item.chilled ?? false }),
              productId: item.productId,
              quantity: item.quantity,
            })),
          },
          {
            onSuccess: (updated) => {
              const repriced = updated.repricedItemIds?.length ?? 0;
              toast.success(
                repriced > 0
                  ? `Sale updated · ${repriced} line${repriced === 1 ? "" : "s"} re-priced`
                  : "Sale updated"
              );
              setStockBlock(null);
              setJustSaved({ id: updated.id, total: updated.totalAmount });
            },
            onError: handleSubmitError,
          }
        );
        return;
      }

      createSale.mutate(
        {
          customerId: values.customerId,
          saleDate: toDateKey(values.saleDate),
          notes: values.notes || undefined,
          /**
           * `unitPrice` is ALWAYS sent, and `discountPercent` NEVER is.
           *
           * The price: the owner may be pricing a seeded product still sitting
           * at 0, and the server treats an explicit price as the snapshot
           * (Gotcha 5) — create-only, by design.
           *
           * The discount: the unified schema is `.strict()`, so including the
           * field — even as 0 — is a 400. The form state carries one only so
           * `LineItemRow` can stay shared.
           */
          items: values.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
        {
          onSuccess: (created) => {
            toast.success(`Sale recorded for ${created.customer.name}`);
            setStockBlock(null);
            setJustSaved({ id: created.id, total: created.totalAmount });
          },
          onError: handleSubmitError,
        }
      );
    },
    () => {
      toast.error("Check the highlighted fields and try again.");
    }
  );

  /** Keep customer + date, clear the lines — the next bill is usually the same shop. */
  function addAnother() {
    form.setValue("items", [emptyUnifiedSaleLine()]);
    form.setValue("notes", "");
    form.clearErrors();
    setJustSaved(null);
  }

  const isLoading = customersQuery.isPending || productsQuery.isPending;

  // ------------------------------------------------------------------
  // Saved confirmation
  // ------------------------------------------------------------------

  if (justSaved) {
    return (
      <>
        <PageHeader title={isEdit ? "Sale updated" : "Sale recorded"} accent="zinc" />
        <motion.div
          {...enterUp(reduceMotion)}
          className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm"
        >
          <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <p className="text-[15px] font-medium text-zinc-900">
            {isEdit ? "Changes saved" : "Sale saved"}
          </p>
          <p className="num mt-1 text-[28px] font-bold text-zinc-900">
            <AnimatedMoney value={justSaved.total} />
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {/**
              * 🔴 "Add another" is CREATE-ONLY, and that is a correctness fix
              * rather than tidiness. In edit mode it would blank the lines while
              * the form was still editing THIS bill — so the next save would
              * replace the edited sale's lines with the new ones, silently, on a
              * screen that looks like a fresh sale. Caught in browser testing.
              */}
            {isEdit ? (
              <Button asChild className="h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800">
                <Link href="/sales">Back to sales</Link>
              </Button>
            ) : (
              <Button
                className="h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800"
                onClick={addAnother}
              >
                <Plus className="mr-2 size-4" aria-hidden />
                Add another
              </Button>
            )}
            {/* Straight to the printable bill — the common next action at the
                counter, and one tap rather than list -> expand -> print. */}
            <Button asChild variant="outline" className="h-11 rounded-lg">
              <Link href={`/receipt/sale/${justSaved.id}`}>
                <Printer className="mr-2 size-4" aria-hidden />
                Print receipt
              </Link>
            </Button>
            {isEdit ? null : (
              <Button asChild variant="outline" className="h-11 rounded-lg">
                <Link href="/sales">View sales</Link>
              </Button>
            )}
          </div>
        </motion.div>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Form
  // ------------------------------------------------------------------

  return (
    <>
      <PageHeader
        title={isEdit ? "Edit sale" : "New sale"}
        description={
          isEdit
            ? "Correct the lines on this bill. Stock adjusts by the difference, and a line's price only changes if you change its product."
            : "Any product from any shop, on one bill. Prices default to the catalog and can be changed per sale."
        }
        accent="zinc"
      />

      <form onSubmit={onSubmit} noValidate>
        {/* pb clears the pinned total bar so the last field is never trapped
            underneath it. */}
        <div className="space-y-5 pb-32">
          <section className="space-y-1.5">
            <Label htmlFor="customer">Customer</Label>
            {isEdit ? (
              /**
               * FIXED ON AN EDIT. Moving a bill to a different customer moves
               * money between two people's ledgers — a different operation from
               * correcting a line, and one the API does not accept. Shown as
               * plain text rather than a disabled control the owner would poke
               * at expecting it to open.
               */
              <>
                <p className="flex h-11 items-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
                  {sale.customer.name}
                </p>
                <p className="text-sm text-zinc-500">
                  A bill stays with its customer. Delete it and ring a new one to
                  move it.
                </p>
              </>
            ) : (
              <CustomerCombobox
                customers={customers}
                isLoading={isLoading}
                value={form.watch("customerId")}
                invalid={Boolean(form.formState.errors.customerId)}
                accent="zinc"
                onChange={(customerId) =>
                  form.setValue("customerId", customerId, { shouldValidate: true })
                }
              />
            )}
            {form.formState.errors.customerId ? (
              <p className="text-sm text-rose-600">
                {form.formState.errors.customerId.message}
              </p>
            ) : null}
          </section>

          <section className="space-y-1.5">
            <Label htmlFor="sale-date">Date</Label>
            <SaleDatePicker
              value={form.watch("saleDate")}
              invalid={Boolean(form.formState.errors.saleDate)}
              onChange={(date) =>
                form.setValue("saleDate", date, { shouldValidate: true })
              }
            />
            {form.formState.errors.saleDate ? (
              <p className="text-sm text-rose-600">
                {form.formState.errors.saleDate.message}
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[18px] font-semibold text-zinc-900">Items</h2>
              <span className="num text-sm text-zinc-500">
                {fields.length} {fields.length === 1 ? "line" : "lines"}
              </span>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-56 w-full rounded-xl" />
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {fields.map((field, index) => (
                    <motion.div
                      key={field.id}
                      layout={reduceMotion ? false : "position"}
                      {...lineItemInOut(reduceMotion)}
                    >
                      <LineItemRow
                        form={form}
                        index={index}
                        groups={saleGroups}
                        optionsById={optionsById}
                        canRemove={fields.length > 1}
                        onRemove={() => remove(index)}
                        searchPlaceholder="Product, brand, size or litres…"
                        // No discount on this endpoint — see the docblock.
                        showDiscount={false}
                        // An EXISTING line's price is read-only: the server
                        // refuses to change it, so offering the field would be
                        // a silent no-op. New lines keep an editable price.
                        priceLocked={isEdit && Boolean(form.getValues(`items.${index}.id`))}
                        extraUnitCost={coolingFor(watchedItems?.[index])}
                      />
                      <ChillToggle
                        form={form}
                        index={index}
                        optionsById={optionsById}
                        locked={isEdit && Boolean(form.getValues(`items.${index}.id`))}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {form.formState.errors.items?.message ? (
              <p className="text-sm text-rose-600">
                {form.formState.errors.items.message}
              </p>
            ) : null}

            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-lg border-dashed"
              onClick={() => append(emptyUnifiedSaleLine())}
            >
              <Plus className="mr-2 size-4" aria-hidden />
              Add item
            </Button>
          </section>

          {/* Stock refusal, directly above the bill so it is the last thing read
              before Save — with the typed sale still on screen underneath. */}
          {stockBlock ? (
            <StockBlockAlert
              shortfalls={stockBlock.shortfalls}
              message={stockBlock.message}
              isRetrying={isPending}
              onRetry={() => onSubmit()}
            />
          ) : null}

          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="font-medium text-zinc-900">Total</dt>
                <dd className="num font-semibold text-zinc-900">
                  {formatPKR(runningTotal)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              placeholder="e.g. Morning drop"
              className="h-11 rounded-lg"
              autoComplete="off"
              {...form.register("notes")}
            />
            {form.formState.errors.notes ? (
              <p className="text-sm text-rose-600">
                {form.formState.errors.notes.message}
              </p>
            ) : null}
          </section>
        </div>

        {/* Pinned total + submit, above the mobile bottom nav. `left-0 md:left-60`
            constrains the BACKGROUND to the content column — with `inset-x-0` it
            would cover the sidebar's Log out button. */}
        <div className="fixed bottom-[68px] left-0 right-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur md:bottom-0 md:left-60">
          <div className="mx-auto flex w-full max-w-[640px] items-center gap-3 px-4 py-3 md:px-8 lg:max-w-[1100px]">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                Total
              </p>
              <AnimatedMoney
                value={runningTotal}
                className="block text-[28px] font-bold leading-tight text-zinc-900"
              />
            </div>

            <Button
              type="submit"
              disabled={createSale.isPending}
              className="h-12 shrink-0 rounded-lg bg-zinc-900 px-6 hover:bg-zinc-800"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Save sale"
              )}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
