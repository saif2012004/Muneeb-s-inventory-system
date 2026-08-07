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
import { karachiToday, toDateKey } from "@/lib/format";
import type { FarmerPurchase } from "@/lib/hooks/use-milk";
import { MODULE_BUTTON_CLASS } from "@/lib/sale-modules";
import { cn } from "@/lib/utils";
import { COMMON_PURCHASE_ITEMS } from "@/lib/validations/milk";

/**
 * Goods a farmer took from the shop — cow food, milk, yogurt, tea powder.
 *
 * This is NOT a sale. It is settled against milk the owner already owes for, so
 * it REDUCES the farmer's net balance rather than creating a receivable.
 * Recording it as a milk sale would double-count: the farmer would be billed
 * and the shop would show revenue it never took in cash.
 *
 * The item chips are a shortcut, not a constraint — the column is free text
 * because the owner sells whatever they sell, and a fixed list would eventually
 * reject a real purchase.
 */
export function PurchaseDialog({
  open,
  onOpenChange,
  mode,
  initial,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: FarmerPurchase | null;
  isPending: boolean;
  onSubmit: (values: {
    purchaseDate: string;
    itemDescription: string;
    amount: number;
    notes: string | null;
  }) => void;
}) {
  const [date, setDate] = useState<Date>(() => karachiToday());
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setDate(initial ? new Date(initial.purchaseDate) : karachiToday());
    setItem(initial?.itemDescription ?? "");
    setAmount(initial ? String(initial.amount) : "");
    setNotes(initial?.notes ?? "");
  }, [open, initial]);

  const amountValue = amount.trim() === "" ? NaN : Number(amount);
  const canSubmit =
    item.trim().length > 0 &&
    !Number.isNaN(amountValue) &&
    amountValue > 0 &&
    !isPending;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      purchaseDate: toDateKey(date),
      itemDescription: item.trim(),
      amount: amountValue,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Record purchase" : "Edit purchase"}
          </DialogTitle>
          <DialogDescription>
            Goods the farmer took. This lowers what you owe them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="purchase-date">Date</Label>
            <SaleDatePicker value={date} onChange={setDate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="purchase-item">Item</Label>
            <Input
              id="purchase-item"
              value={item}
              onChange={(event) => setItem(event.target.value)}
              placeholder="e.g. Cow food"
              className="h-11 rounded-lg"
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {COMMON_PURCHASE_ITEMS.map((common) => (
                <button
                  key={common}
                  type="button"
                  onClick={() => setItem(common)}
                  className={cn(
                    "min-h-[44px] rounded-lg border px-3 text-sm transition-colors",
                    item === common
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  )}
                >
                  {common}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="purchase-amount">Amount</Label>
            <Input
              id="purchase-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="e.g. 1500"
              inputMode="decimal"
              className="num h-11 rounded-lg"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="purchase-notes">Notes (optional)</Label>
            <Input
              id="purchase-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything worth remembering"
              className="h-11 rounded-lg"
              autoComplete="off"
            />
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
            className={cn("h-11 rounded-lg", MODULE_BUTTON_CLASS.emerald)}
            disabled={!canSubmit}
            onClick={submit}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : mode === "create" ? (
              "Record purchase"
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
