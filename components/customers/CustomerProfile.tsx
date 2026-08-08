"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  LogIn,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { CustomerDialog } from "@/components/customers/CustomerDialog";
import { PaymentDialog } from "@/components/customers/PaymentDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { MoneyText } from "@/components/shared/MoneyText";
import { ExportCsvButton } from "@/components/shared/ExportCsvButton";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatPKR } from "@/lib/format";
import {
  useCreatePayment,
  useCustomerProfile,
  useDeletePayment,
  useUpdateCustomer,
  useUpdatePayment,
  type LedgerEntry,
  type Payment,
  type Purchase,
} from "@/lib/hooks/use-customers";
import {
  BALANCE_TEXT_CLASS,
  MODULE_DOT_CLASS,
  MODULE_LABEL,
  balanceLabel,
  balanceMagnitude,
  balanceMoneyTone,
  balanceTone,
} from "@/lib/receivables-display";
import { cn } from "@/lib/utils";
import {
  CUSTOMER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/validations/customers";

/**
 * One customer's ledger: what they bought, what they paid, and how the balance
 * moved between the two.
 *
 * Every number rendered here came from the server's shared calculation. The UI
 * never subtracts a payment from a total itself — that is how two screens end
 * up quoting different balances for the same customer.
 */
export function CustomerProfile({ customerId }: { customerId: string }) {
  const reduceMotion = useReducedMotion();
  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<Payment | null>(null);

  const profileQuery = useCustomerProfile(customerId);
  const updateCustomer = useUpdateCustomer();
  const createPayment = useCreatePayment(customerId);
  const updatePayment = useUpdatePayment(customerId);
  const deletePayment = useDeletePayment(customerId);

  function reportError(error: unknown, fallback: string) {
    if (error instanceof ApiError) {
      if (error.isSessionExpired) {
        toast.error(error.message);
        redirectToLogin();
        return;
      }
      toast.error(error.message);
      return;
    }
    toast.error(fallback);
  }

  const backLink = (
    <Link
      href="/customers"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
    >
      <ArrowLeft className="size-4" aria-hidden />
      All customers
    </Link>
  );

  // ------------------------------------------------------------------
  // Session / error / loading
  // ------------------------------------------------------------------

  if (
    profileQuery.error instanceof ApiError &&
    profileQuery.error.isSessionExpired
  ) {
    return (
      <>
        {backLink}
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to see this customer."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  if (profileQuery.error) {
    return (
      <>
        {backLink}
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load this customer"
          description={
            profileQuery.error instanceof ApiError
              ? profileQuery.error.message
              : "Something went wrong."
          }
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => profileQuery.refetch()}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  if (profileQuery.isPending) {
    return (
      <>
        {backLink}
        <Skeleton className="h-10 w-56 rounded-lg" />
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((card) => (
            <Skeleton key={card} className="h-[104px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-6 h-64 w-full rounded-xl" />
      </>
    );
  }

  const { customer, balance, purchases, payments, ledger } = profileQuery.data;
  const tone = balanceTone(balance.outstanding);

  return (
    <>
      {backLink}

      <PageHeader
        title={customer.name}
        description={
          [
            CUSTOMER_TYPE_LABELS[customer.type],
            customer.phone,
            customer.isActive ? null : "Inactive",
          ]
            .filter(Boolean)
            .join(" · ")
        }
        action={
          <div className="flex gap-2">
            {/* The balances export is a full snapshot across every customer,
                not just this one — there is no per-customer CSV type, and
                inventing one would mean a second shape to keep in step. */}
            <ExportCsvButton type="customer_balances" label="Export" />
            <Button
              variant="outline"
              className="h-11 rounded-lg"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="mr-2 size-4" aria-hidden />
              Edit
            </Button>
          </div>
        }
      />

      {/* Three stat cards --------------------------------------------- */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className="grid gap-3 sm:grid-cols-3"
      >
        <StatBlock label="Total billed" value={balance.totalBilled} />
        <StatBlock label="Total paid" value={balance.totalPaid} />
        <div
          className={cn(
            "rounded-xl border bg-white p-5 shadow-sm",
            tone === "owed" ? "border-rose-200" : "border-zinc-200"
          )}
        >
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            Outstanding
          </p>
          <MoneyText
            value={balanceMagnitude(balance.outstanding)}
            tone={balanceMoneyTone(balance.outstanding)}
            className="mt-2 block text-[28px] font-bold leading-tight"
          />
          <p className={cn("mt-1 text-sm", BALANCE_TEXT_CLASS[tone])}>
            {balanceLabel(balance.outstanding)}
          </p>
        </div>
      </motion.div>

      {/* Tabs ---------------------------------------------------------- */}
      <Tabs defaultValue="purchases" className="mt-6">
        <TabsList>
          <TabsTrigger value="purchases">
            Purchases
            <span className="num ml-1.5 text-xs text-zinc-500">
              {purchases.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="payments">
            Payments
            <span className="num ml-1.5 text-xs text-zinc-500">
              {payments.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="balance">Balance</TabsTrigger>
        </TabsList>

        <TabsContent value="purchases" className="mt-4">
          <PurchasesTab purchases={purchases} />
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button
              className="h-11 rounded-lg"
              onClick={() => {
                setEditingPayment(null);
                setPaymentOpen(true);
              }}
            >
              <Plus className="mr-2 size-4" aria-hidden />
              Record payment
            </Button>
          </div>
          <PaymentsTab
            payments={payments}
            onEdit={(payment) => {
              setEditingPayment(payment);
              setPaymentOpen(true);
            }}
            onDelete={setDeletingPayment}
          />
        </TabsContent>

        <TabsContent value="balance" className="mt-4">
          <BalanceTab ledger={ledger} reduceMotion={Boolean(reduceMotion)} />
        </TabsContent>
      </Tabs>

      {/* Dialogs ------------------------------------------------------- */}
      <CustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        initial={{
          name: customer.name,
          phone: customer.phone,
          type: customer.type,
        }}
        isPending={updateCustomer.isPending}
        onSubmit={(values) =>
          updateCustomer.mutate(
            { id: customer.id, ...values },
            {
              onSuccess: () => {
                toast.success("Customer updated");
                setEditOpen(false);
              },
              onError: (error) =>
                reportError(error, "Couldn't update the customer."),
            }
          )
        }
      />

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={(open) => {
          setPaymentOpen(open);
          if (!open) setEditingPayment(null);
        }}
        mode={editingPayment ? "edit" : "create"}
        // For an EDIT, the "before" balance excludes this payment's current
        // amount — otherwise the preview would double-count it and tell the
        // owner the wrong thing about what they're about to save.
        outstanding={
          editingPayment
            ? balance.outstanding + editingPayment.amount
            : balance.outstanding
        }
        initial={
          editingPayment
            ? {
                paymentDate: new Date(editingPayment.paymentDate),
                amount: editingPayment.amount,
                method: editingPayment.method,
                notes: editingPayment.notes,
              }
            : undefined
        }
        isPending={createPayment.isPending || updatePayment.isPending}
        onSubmit={(values) => {
          const onSuccess = () => {
            toast.success(editingPayment ? "Payment updated" : "Payment recorded");
            setPaymentOpen(false);
            setEditingPayment(null);
          };
          const onError = (error: unknown) =>
            reportError(error, "Couldn't save the payment.");

          if (editingPayment) {
            updatePayment.mutate(
              { paymentId: editingPayment.id, ...values },
              { onSuccess, onError }
            );
          } else {
            createPayment.mutate(values, { onSuccess, onError });
          }
        }}
      />

      <Dialog
        open={deletingPayment !== null}
        onOpenChange={(open) => !open && setDeletingPayment(null)}
      >
        <DialogContent className="rounded-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this payment?</DialogTitle>
            <DialogDescription>
              {deletingPayment
                ? `Removing this ${formatPKR(deletingPayment.amount)} payment puts ${customer.name}'s outstanding balance back up by that amount. This can't be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-lg"
              disabled={deletePayment.isPending}
              onClick={() => setDeletingPayment(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-11 rounded-lg"
              disabled={deletePayment.isPending}
              onClick={() => {
                if (!deletingPayment) return;
                deletePayment.mutate(deletingPayment.id, {
                  onSuccess: () => {
                    toast.success("Payment deleted");
                    setDeletingPayment(null);
                  },
                  onError: (error) =>
                    reportError(error, "Couldn't delete the payment."),
                });
              }}
            >
              {deletePayment.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Deleting…
                </>
              ) : (
                "Delete payment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="num mt-2 text-[28px] font-bold leading-tight text-zinc-900">
        {formatPKR(value)}
      </p>
    </div>
  );
}

/** Purchases across all three modules, newest first, each tagged by module. */
function PurchasesTab({ purchases }: { purchases: Purchase[] }) {
  if (purchases.length === 0) {
    return (
      <EmptyState
        title="No purchases yet"
        description="Sales recorded for this customer will appear here."
      />
    );
  }

  return (
    <div className="space-y-2">
      {purchases.map((purchase) => {
        // Milk has no sale detail page yet (Phase 5), so those rows stay flat
        // rather than linking somewhere that 404s.
        const href =
          purchase.module === "milk" ? null : `/${purchase.module}`;

        const body = (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    MODULE_DOT_CLASS[purchase.module]
                  )}
                  aria-hidden
                />
                <p className="truncate text-[15px] font-medium text-zinc-900">
                  {MODULE_LABEL[purchase.module]}
                </p>
              </div>
              <p className="num mt-1 pl-4 text-sm text-zinc-500">
                {formatDate(purchase.saleDate)}
                {purchase.itemCount !== null ? (
                  <>
                    <span className="mx-1.5 text-zinc-300">·</span>
                    {purchase.itemCount}{" "}
                    {purchase.itemCount === 1 ? "item" : "items"}
                  </>
                ) : null}
                {purchase.detail ? (
                  <>
                    <span className="mx-1.5 text-zinc-300">·</span>
                    {purchase.detail}
                  </>
                ) : null}
              </p>
            </div>
            <span className="num shrink-0 text-[15px] font-semibold text-zinc-900">
              {formatPKR(purchase.totalAmount)}
            </span>
          </div>
        );

        return href ? (
          <Link
            key={`${purchase.module}-${purchase.id}`}
            href={href}
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            {body}
          </Link>
        ) : (
          <div key={`${purchase.module}-${purchase.id}`}>{body}</div>
        );
      })}
    </div>
  );
}

function PaymentsTab({
  payments,
  onEdit,
  onDelete,
}: {
  payments: Payment[];
  onEdit: (payment: Payment) => void;
  onDelete: (payment: Payment) => void;
}) {
  if (payments.length === 0) {
    return (
      <EmptyState
        title="No payments yet"
        description="Record a payment when this customer settles part of their balance."
      />
    );
  }

  return (
    <div className="space-y-2">
      {payments.map((payment) => (
        <div
          key={payment.id}
          className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
        >
          <div className="min-w-0">
            <p className="num text-[15px] font-medium text-emerald-600">
              {formatPKR(payment.amount)}
            </p>
            <p className="num mt-1 text-sm text-zinc-500">
              {formatDate(payment.paymentDate)}
              {payment.method ? (
                <>
                  <span className="mx-1.5 text-zinc-300">·</span>
                  {PAYMENT_METHOD_LABELS[payment.method]}
                </>
              ) : null}
            </p>
            {payment.notes ? (
              <p className="mt-1 text-sm text-zinc-500">{payment.notes}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onEdit(payment)}
              className="flex size-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
            >
              <Pencil className="size-4" aria-hidden />
              <span className="sr-only">Edit payment</span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(payment)}
              className="flex size-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Delete payment</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The running-balance timeline: every sale (+) and payment (−) in date order,
 * each showing what the outstanding was AFTER it.
 *
 * Oldest first, deliberately — a running balance only makes sense read
 * downwards, and reversing it would make each row's total look wrong relative
 * to the one above.
 */
function BalanceTab({
  ledger,
  reduceMotion,
}: {
  ledger: LedgerEntry[];
  reduceMotion: boolean;
}) {
  if (ledger.length === 0) {
    return (
      <EmptyState
        title="Nothing to show yet"
        description="Once there are sales or payments, the running balance appears here."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-zinc-100 bg-zinc-50/60 px-4 py-2.5 text-[13px] font-medium uppercase tracking-wide text-zinc-500">
        <span className="flex-1">Entry</span>
        <span className="w-24 text-right">Change</span>
        <span className="w-28 text-right">Balance</span>
      </div>

      <AnimatePresence initial={false}>
        {ledger.map((entry, index) => {
          const isPayment = entry.kind === "payment";
          return (
            <motion.div
              key={`${entry.kind}-${entry.id}`}
              initial={reduceMotion ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: "spring",
                stiffness: 500,
                damping: 40,
                delay: reduceMotion ? 0 : Math.min(index * 0.02, 0.2),
              }}
              className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      isPayment
                        ? "bg-emerald-600"
                        : MODULE_DOT_CLASS[entry.module ?? "beverages"]
                    )}
                    aria-hidden
                  />
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {entry.label}
                  </p>
                </div>
                <p className="num mt-0.5 pl-4 text-xs text-zinc-500">
                  {formatDate(entry.date)}
                  {entry.itemCount !== null ? (
                    <>
                      <span className="mx-1.5 text-zinc-300">·</span>
                      {entry.itemCount}{" "}
                      {entry.itemCount === 1 ? "item" : "items"}
                    </>
                  ) : null}
                </p>
              </div>

              {/* The sign is the point of this column: a sale adds to what is
                  owed, a payment takes away. */}
              <span
                className={cn(
                  "num w-24 shrink-0 text-right text-sm font-medium",
                  isPayment ? "text-emerald-600" : "text-zinc-900"
                )}
              >
                {isPayment ? "−" : "+"}
                {formatPKR(Math.abs(entry.amount))}
              </span>

              <span
                className={cn(
                  "num w-28 shrink-0 text-right text-sm font-semibold",
                  entry.runningBalance > 0
                    ? "text-rose-600"
                    : entry.runningBalance < 0
                      ? "text-emerald-600"
                      : "text-zinc-500"
                )}
              >
                {formatPKR(Math.abs(entry.runningBalance))}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
