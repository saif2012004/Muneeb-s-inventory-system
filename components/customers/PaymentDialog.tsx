"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { SaleDatePicker } from "@/components/sales/SaleDatePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPKR, karachiToday, toDateKey } from "@/lib/format";
import { balanceMagnitude, balanceTone } from "@/lib/receivables-display";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/validations/customers";
import { cn } from "@/lib/utils";

const NO_METHOD = "__none__";

/**
 * Record or correct a payment.
 *
 * The amount is held as a STRING while typing, for the same reason the sale
 * form does it: a number-typed input can't represent "being cleared" or
 * "half-typed", and fighting the keyboard mid-keystroke is worse on a phone
 * than anywhere else.
 *
 * Shows the current outstanding and a live preview of what the balance becomes,
 * so the owner can see they're about to settle someone exactly — the most
 * common intent, and the easiest to get wrong by a rupee.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  mode,
  outstanding,
  initial,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Balance BEFORE this payment (for edit, excluding its old amount). */
  outstanding: number;
  initial?: {
    paymentDate: Date;
    amount: number;
    method: PaymentMethod | null;
    notes: string | null;
  };
  isPending: boolean;
  onSubmit: (values: {
    paymentDate: string;
    amount: number;
    method: PaymentMethod | null;
    notes: string | null;
  }) => void;
}) {
  const [date, setDate] = useState<Date>(karachiToday());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>(NO_METHOD);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setDate(initial?.paymentDate ?? karachiToday());
    setAmount(initial ? String(initial.amount) : "");
    setMethod(initial?.method ?? NO_METHOD);
    setNotes(initial?.notes ?? "");
  }, [open, initial]);

  const parsed = Number(amount.trim());
  const isValidAmount = amount.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
  const canSubmit = isValidAmount && !isPending;

  // Preview only — the SERVER recomputes the real balance from the shared
  // calculation on save. This exists to answer "does this settle them?"
  const projected = isValidAmount ? outstanding - parsed : outstanding;
  const projectedTone = balanceTone(projected);

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      paymentDate: toDateKey(date),
      amount: parsed,
      method: method === NO_METHOD ? null : (method as PaymentMethod),
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Record payment" : "Edit payment"}
          </DialogTitle>
          <DialogDescription>
            Recording a payment never changes a past sale — the balance is
            calculated from both.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="payment-date">Date</Label>
            <SaleDatePicker value={date} onChange={setDate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-amount">Amount</Label>
            <Input
              id="payment-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="num h-11 rounded-lg"
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            {amount.trim() !== "" && !isValidAmount ? (
              <p className="text-sm text-rose-600">
                Enter an amount greater than 0.
              </p>
            ) : null}
          </div>

          {/* Settle-in-full shortcut. The owner's most common intent is "they
              paid off what they owe", and typing it by hand invites a typo. */}
          {outstanding > 0 ? (
            <button
              type="button"
              className="text-sm font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
              onClick={() => setAmount(String(outstanding))}
            >
              Pay full balance ({formatPKR(outstanding)})
            </button>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="payment-method">Method (optional)</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="payment-method" className="h-11 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_METHOD}>Not recorded</SelectItem>
                {PAYMENT_METHODS.map((paymentMethod) => (
                  <SelectItem key={paymentMethod} value={paymentMethod}>
                    {PAYMENT_METHOD_LABELS[paymentMethod]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-notes">Notes (optional)</Label>
            <Input
              id="payment-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="e.g. Settled last month's account"
              className="h-11 rounded-lg"
              autoComplete="off"
            />
          </div>

          <div className="flex items-baseline justify-between rounded-lg bg-zinc-50 px-3 py-2.5">
            <span className="text-sm text-zinc-500">Balance after this</span>
            <span
              className={cn(
                "num text-[15px] font-semibold",
                projectedTone === "owed" && "text-rose-600",
                projectedTone === "credit" && "text-emerald-600",
                projectedTone === "settled" && "text-zinc-900"
              )}
            >
              {formatPKR(balanceMagnitude(projected))}
              {projectedTone === "credit" ? " credit" : null}
              {projectedTone === "settled" ? " · settled" : null}
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="h-11 rounded-lg"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="h-11 rounded-lg"
            disabled={!canSubmit}
            onClick={submit}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : mode === "create" ? (
              "Record payment"
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
