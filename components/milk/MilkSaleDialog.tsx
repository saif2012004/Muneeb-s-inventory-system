"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { CustomerCombobox } from "@/components/sales/CustomerCombobox";
import { MoneyText } from "@/components/shared/MoneyText";
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
import { formatLiters, karachiToday, toDateKey } from "@/lib/format";
import { useCustomers } from "@/lib/hooks/use-customers";
import type { MilkSale } from "@/lib/hooks/use-milk";
import { MODULE_BUTTON_CLASS } from "@/lib/sale-modules";
import { cn } from "@/lib/utils";

/**
 * Record or correct a milk SALE — milk going out to a hotel, shop or
 * individual. The opposite direction from a delivery.
 *
 * A dialog rather than a full page like `/beverages/new-sale`, because there is
 * nothing to build up: one customer, litres, a rate. The multi-line sale form
 * exists to assemble a basket, and a milk sale has no basket — no line items,
 * no product picker, no price snapshot. Reusing that form here would mean
 * bending it around a shape it was not built for.
 *
 * THE CUSTOMER CANNOT BE CHANGED ON AN EDIT. Moving a sale between customers
 * rewrites two balances at once with nothing on either ledger explaining why;
 * the fix for a misfiled sale is to delete it and enter it again. The API
 * enforces this too — this is not the only guard.
 */
export function MilkSaleDialog({
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
  initial?: MilkSale | null;
  isPending: boolean;
  onSubmit: (values: {
    customerId: string;
    saleDate: string;
    liters: number;
    ratePerLiter: number;
    notes: string | null;
  }) => void;
}) {
  // Names only — the balances would be four aggregate queries to render a
  // dropdown.
  const customersQuery = useCustomers({ withBalances: false });

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState<Date>(() => karachiToday());
  const [liters, setLiters] = useState("");
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setCustomerId(initial?.customerId ?? "");
    setDate(initial ? new Date(initial.saleDate) : karachiToday());
    setLiters(initial ? String(initial.liters) : "");
    setRate(initial ? String(initial.ratePerLiter) : "");
    setNotes(initial?.notes ?? "");
  }, [open, initial]);

  const litersValue = liters.trim() === "" ? NaN : Number(liters);
  const rateValue = rate.trim() === "" ? NaN : Number(rate);

  const litersOk = !Number.isNaN(litersValue) && litersValue > 0;
  const rateOk = !Number.isNaN(rateValue) && rateValue > 0;
  const canSubmit =
    customerId !== "" && litersOk && rateOk && !isPending;

  const total = litersOk && rateOk ? litersValue * rateValue : 0;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      customerId,
      saleDate: toDateKey(date),
      liters: litersValue,
      ratePerLiter: rateValue,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Record milk sale" : "Edit milk sale"}
          </DialogTitle>
          <DialogDescription>
            Milk you sold. This adds to what the customer owes you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            {mode === "edit" ? (
              <div className="flex min-h-[44px] items-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-600">
                {initial?.customer.name ?? "—"}
              </div>
            ) : (
              <CustomerCombobox
                customers={customersQuery.data ?? []}
                isLoading={customersQuery.isPending}
                value={customerId}
                onChange={setCustomerId}
                accent="emerald"
              />
            )}
            {mode === "edit" ? (
              <p className="text-xs text-zinc-500">
                To move this sale to another customer, delete it and record it
                again.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="milk-sale-date">Date</Label>
            <SaleDatePicker value={date} onChange={setDate} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="milk-sale-liters">Litres</Label>
              <Input
                id="milk-sale-liters"
                value={liters}
                onChange={(event) => setLiters(event.target.value)}
                placeholder="e.g. 20"
                inputMode="decimal"
                className="num h-11 rounded-lg"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="milk-sale-rate">Rate per litre</Label>
              <Input
                id="milk-sale-rate"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                placeholder="e.g. 230"
                inputMode="decimal"
                className="num h-11 rounded-lg"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="milk-sale-notes">Notes (optional)</Label>
            <Input
              id="milk-sale-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything worth remembering"
              className="h-11 rounded-lg"
              autoComplete="off"
            />
          </div>

          {/* Display only — the stored total is always the server's. */}
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-3">
            <span className="num text-sm text-zinc-500">
              {litersOk ? formatLiters(litersValue) : "—"}
            </span>
            <MoneyText
              value={total}
              tone="emerald"
              className="text-[17px] font-semibold"
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
              "Record sale"
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
