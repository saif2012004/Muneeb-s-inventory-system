"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Loader2, LogIn, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { CustomerCombobox } from "@/components/sales/CustomerCombobox";
import { StockBlockAlert } from "@/components/sales/StockBlockAlert";
import { LineItemRow } from "@/components/sales/LineItemRow";
import { SaleDatePicker } from "@/components/sales/SaleDatePicker";
import { AnimatedMoney } from "@/components/shared/AnimatedMoney";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ApiError,
  redirectToLogin,
  type StockShortfall,
} from "@/lib/api-client";
import { formatPKR, karachiToday, toDateKey } from "@/lib/format";
import { useProducts } from "@/lib/hooks/use-catalog";
import { useCustomers } from "@/lib/hooks/use-customers";
import { useCreateSale } from "@/lib/hooks/use-sales";
import { ACCENTS } from "@/lib/nav";
import { groupSaleProducts, indexSaleProducts } from "@/lib/sale-catalog";
import {
  MODULE_BUTTON_CLASS,
  type SaleModule,
} from "@/lib/sale-modules";
import { cn } from "@/lib/utils";
import {
  emptySaleLine,
  newSaleFormSchema,
  previewLineTotal,
  previewSaleTotal,
  type SaleFormOutput,
  type SaleFormValues,
} from "@/lib/validations/sale-form";

/**
 * The owner's most-used screen, shared by every sale module.
 *
 * Tuned for one-handed use on a cheap Android phone in daylight: 44px targets,
 * numeric keypads, a total pinned where the thumb already is, and no state that
 * looks frozen.
 *
 * The module supplies the endpoint, the catalog category, the accent and the
 * wording. Everything else — the price-snapshot behaviour, the running total,
 * the validation — is identical by design, because the rules are identical.
 */
export function NewSaleForm({ module }: { module: SaleModule }) {
  const reduceMotion = useReducedMotion();
  const [justSaved, setJustSaved] = useState<{ id: string; total: number } | null>(
    null
  );
  /**
   * The last stock refusal, kept so the owner can restock and retry WITHOUT
   * losing the sale they have already typed. Cleared on every fresh submit and
   * on a successful save.
   */
  const [stockBlock, setStockBlock] = useState<{
    message: string;
    shortfalls: StockShortfall[];
  } | null>(null);

  const accent = ACCENTS[module.accent];
  const primaryButton = MODULE_BUTTON_CLASS[module.accent];

  const customersQuery = useCustomers();
  // Active products only: the API refuses a deactivated product on a new sale,
  // so offering one would only produce an error the owner can't act on.
  const productsQuery = useProducts(false);
  const createSale = useCreateSale(module);

  const form = useForm<SaleFormValues, unknown, SaleFormOutput>({
    resolver: zodResolver(newSaleFormSchema),
    defaultValues: {
      customerId: "",
      saleDate: karachiToday(),
      notes: "",
      discountPercent: "",
      items: [emptySaleLine()],
    },
    // Errors appear once a field has been touched and correct live after —
    // validating from the first keystroke would shout at a half-typed line.
    mode: "onTouched",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  // Matched on the category NAME rather than a hardcoded id, so a renamed or
  // owner-recreated category still resolves. The server does the authoritative
  // check; this only decides what the picker offers.
  const saleGroups = useMemo(() => {
    const products = (productsQuery.data ?? []).filter(
      (product) =>
        product.subCategory.category.name.trim().toLowerCase() ===
        module.label.toLowerCase()
    );
    return groupSaleProducts(products);
  }, [productsQuery.data, module.label]);

  const optionsById = useMemo(() => indexSaleProducts(saleGroups), [saleGroups]);

  // The live running total. Watched rather than derived from `fields`, because
  // `fields` is a snapshot taken at render and would lag every keystroke.
  const watchedItems = useWatch({ control: form.control, name: "items" });
  const billDiscount = useWatch({ control: form.control, name: "discountPercent" }) ?? "";

  /**
   * The bill, in the order the server computes it (lib/sales.ts):
   * line discounts are already inside each line total, those sum to a subtotal,
   * and the whole-bill discount applies to that subtotal — never the reverse.
   */
  const subtotal = (watchedItems ?? []).reduce(
    (total, item) =>
      total +
      previewLineTotal(
        item?.quantity ?? "",
        item?.unitPrice ?? "",
        item?.discountPercent ?? ""
      ),
    0
  );
  const runningTotal = previewSaleTotal(subtotal, billDiscount);
  const billSaving = subtotal - runningTotal;

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
        <PageHeader title="New sale" accent={module.accent} />
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to record a sale."
          accent={module.accent}
          action={
            <Button
              className={cn("h-11 rounded-lg", primaryButton)}
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
        <PageHeader title="New sale" accent={module.accent} />
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load the form"
          description={
            loadError instanceof ApiError
              ? loadError.message
              : "Something went wrong."
          }
          accent={module.accent}
          action={
            <Button
              className={cn("h-11 rounded-lg", primaryButton)}
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

  const onSubmit = form.handleSubmit(
    (values) => {
      // A retry starts from a clean slate: the alert must never outlive the
      // problem it describes.
      setStockBlock(null);
      createSale.mutate(
        {
          customerId: values.customerId,
          saleDate: toDateKey(values.saleDate),
          notes: values.notes || undefined,
          discountPercent: values.discountPercent,
          // unitPrice is ALWAYS sent: the owner may be pricing a 0-priced
          // seeded product at the point of sale, and the server treats an
          // explicit price as the snapshot (Gotcha 5).
          items: values.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountPercent: item.discountPercent,
          })),
        },
        {
          onSuccess: (sale) => {
            toast.success(`Sale recorded for ${sale.customer.name}`);
            setStockBlock(null);
            setJustSaved({ id: sale.id, total: sale.totalAmount });
          },
          onError: (error) => {
            if (error instanceof ApiError && error.isSessionExpired) {
              toast.error(error.message);
              redirectToLogin();
              return;
            }
            /**
             * Insufficient stock is NOT a toast. A toast disappears, and this
             * one carries the numbers the owner needs plus the controls to fix
             * them — so it is rendered into the form and stays until resolved.
             */
            if (error instanceof ApiError && error.isBlockedByStock) {
              setStockBlock({
                message: error.message,
                shortfalls: error.shortBy,
              });
              return;
            }
            // The API's messages are specific and actionable — "X is
            // deactivated and can't be added to a new sale", "That customer no
            // longer exists" — so they're shown verbatim.
            toast.error(
              error instanceof ApiError
                ? error.message
                : "Couldn't record the sale."
            );
          },
        }
      );
    },
    () => {
      toast.error("Check the highlighted fields and try again.");
    }
  );

  /** Keep customer + date, clear the lines — the common case is another sale to the same shop. */
  function addAnother() {
    form.setValue("items", [emptySaleLine()]);
    form.setValue("notes", "");
    /**
     * The whole-bill discount is CLEARED, like the notes and unlike the customer.
     *
     * Found in browser testing: it used to persist, so recording a 5%-off bill
     * and tapping "Add another" silently applied 5% to the next sale too. A
     * discount is a decision about ONE bill — a per-line one goes with the line
     * that was just cleared, and this is the same thing at bill level. Carrying
     * it forward gives money away without anyone typing anything.
     */
    form.setValue("discountPercent", "");
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
        <PageHeader title="Sale recorded" accent={module.accent} />
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm"
        >
          <span
            className={cn(
              "mx-auto mb-4 flex size-12 items-center justify-center rounded-xl",
              accent.icon
            )}
          >
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <p className="text-[15px] font-medium text-zinc-900">Sale saved</p>
          <p className={cn("num mt-1 text-[28px] font-bold", accent.text)}>
            <AnimatedMoney value={justSaved.total} />
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              className={cn("h-11 rounded-lg", primaryButton)}
              onClick={addAnother}
            >
              <Plus className="mr-2 size-4" aria-hidden />
              Add another
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-lg">
              <Link href={module.listRoute}>View sales</Link>
            </Button>
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
        title="New sale"
        description={module.formDescription}
        accent={module.accent}
      />

      <form onSubmit={onSubmit} noValidate>
        {/* pb clears the pinned total bar so the last field is never trapped
            underneath it. */}
        <div className="space-y-5 pb-32">
          <section className="space-y-1.5">
            <Label htmlFor="customer">Customer</Label>
            <CustomerCombobox
              customers={customers}
              isLoading={isLoading}
              value={form.watch("customerId")}
              invalid={Boolean(form.formState.errors.customerId)}
              accent={module.accent}
              onChange={(customerId) =>
                form.setValue("customerId", customerId, { shouldValidate: true })
              }
            />
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
                      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={
                        reduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, y: 8, scale: 0.98 }
                      }
                      transition={{ type: "spring", stiffness: 480, damping: 38 }}
                    >
                      <LineItemRow
                        form={form}
                        index={index}
                        groups={saleGroups}
                        optionsById={optionsById}
                        canRemove={fields.length > 1}
                        onRemove={() => remove(index)}
                        searchPlaceholder={
                          module.key === "beverages"
                            ? "Brand, size or discount…"
                            : "Product, tier or shape…"
                        }
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
              onClick={() => append(emptySaleLine())}
            >
              <Plus className="mr-2 size-4" aria-hidden />
              Add item
            </Button>
          </section>

          {/* Stock refusal. Sits directly above the bill so it is the last
              thing read before the Save button, and the sale it refers to is
              still on screen underneath, untouched. */}
          {stockBlock ? (
            <StockBlockAlert
              shortfalls={stockBlock.shortfalls}
              message={stockBlock.message}
              isRetrying={createSale.isPending}
              onRetry={() => onSubmit()}
            />
          ) : null}

          {/* Whole-bill discount + the breakdown -------------------------- */}
          <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="space-y-1.5">
              <Label htmlFor="bill-discount">
                Whole-bill discount % (optional)
              </Label>
              <Input
                id="bill-discount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                className={cn(
                  "num h-11 rounded-lg",
                  form.formState.errors.discountPercent &&
                    "border-rose-400 focus-visible:ring-rose-400"
                )}
                {...form.register("discountPercent")}
              />
              {form.formState.errors.discountPercent ? (
                <p className="text-sm text-rose-600">
                  {form.formState.errors.discountPercent.message}
                </p>
              ) : (
                <p className="text-sm text-zinc-500">
                  Applied after any per-line discounts.
                </p>
              )}
            </div>

            {/* The arithmetic, shown. The owner should be able to SEE how the
                total was reached rather than trust a single figure — this is
                the screen where a mistyped percentage costs real money. */}
            <dl className="space-y-1.5 border-t border-zinc-100 pt-3 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-zinc-500">Subtotal after line discounts</dt>
                <dd className="num font-medium text-zinc-900">
                  {formatPKR(subtotal)}
                </dd>
              </div>
              {billSaving > 0 ? (
                <div className="flex items-baseline justify-between">
                  <dt className="text-zinc-500">Bill discount</dt>
                  <dd className="num font-medium text-emerald-600">
                    −{formatPKR(billSaving)}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between border-t border-zinc-100 pt-1.5">
                <dt className="font-medium text-zinc-900">Total</dt>
                <dd className={cn("num font-semibold", accent.text)}>
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

        {/* Pinned total + submit. Sits above the mobile bottom nav.
            `left-0 md:left-60` constrains the BACKGROUND to the content column:
            with `inset-x-0` the bar spanned the full viewport and its white
            background covered the sidebar's Log out button, since `md:pl-60`
            only pads the inner content, not the panel itself. */}
        <div className="fixed bottom-[68px] left-0 right-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur md:bottom-0 md:left-60">
          <div className="mx-auto flex w-full max-w-[640px] items-center gap-3 px-4 py-3 md:px-8 lg:max-w-[1100px]">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                Total
              </p>
              <AnimatedMoney
                value={runningTotal}
                className={cn(
                  "block text-[28px] font-bold leading-tight",
                  accent.text
                )}
              />
            </div>

            <Button
              type="submit"
              disabled={createSale.isPending}
              className={cn("h-12 shrink-0 rounded-lg px-6", primaryButton)}
            >
              {createSale.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Saving…
                </>
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
