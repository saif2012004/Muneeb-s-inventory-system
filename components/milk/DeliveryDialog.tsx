"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

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
import type { Delivery } from "@/lib/hooks/use-milk";
import { MODULE_BUTTON_CLASS } from "@/lib/sale-modules";
import { cn } from "@/lib/utils";

/**
 * Record or correct ONE delivery, for owners who want a single entry rather
 * than the quick-entry grid — and for fixing a row after the fact.
 *
 * MORNING AND EVENING ARE BOTH OPTIONAL, but at least one must carry milk. An
 * empty box means that session did not happen, which is NOT the same as zero
 * litres — the columns are nullable precisely to keep those apart, so an
 * untouched box submits `null` and never `0`.
 */
export function DeliveryDialog({
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
  initial?: Delivery | null;
  isPending: boolean;
  onSubmit: (values: {
    deliveryDate: string;
    morningLiters: number | null;
    eveningLiters: number | null;
    ratePerLiter: number;
    notes: string | null;
  }) => void;
}) {
  const [date, setDate] = useState<Date>(() => karachiToday());
  const [morning, setMorning] = useState("");
  const [evening, setEvening] = useState("");
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");

  // Reseed on open so editing delivery B never shows delivery A's numbers.
  useEffect(() => {
    if (!open) return;
    setDate(initial ? new Date(initial.deliveryDate) : karachiToday());
    setMorning(
      initial?.morningLiters === null || initial?.morningLiters === undefined
        ? ""
        : String(initial.morningLiters)
    );
    setEvening(
      initial?.eveningLiters === null || initial?.eveningLiters === undefined
        ? ""
        : String(initial.eveningLiters)
    );
    setRate(initial ? String(initial.ratePerLiter) : "");
    setNotes(initial?.notes ?? "");
  }, [open, initial]);

  const morningValue = morning.trim() === "" ? null : Number(morning);
  const eveningValue = evening.trim() === "" ? null : Number(evening);
  const rateValue = rate.trim() === "" ? NaN : Number(rate);

  const litersOk =
    (morningValue === null || (!Number.isNaN(morningValue) && morningValue >= 0)) &&
    (eveningValue === null || (!Number.isNaN(eveningValue) && eveningValue >= 0));
  const totalLiters = (morningValue ?? 0) + (eveningValue ?? 0);
  const rateOk = !Number.isNaN(rateValue) && rateValue > 0;

  const canSubmit = litersOk && totalLiters > 0 && rateOk && !isPending;
  const total = canSubmit ? totalLiters * rateValue : 0;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      deliveryDate: toDateKey(date),
      morningLiters: morningValue,
      eveningLiters: eveningValue,
      ratePerLiter: rateValue,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Record delivery" : "Edit delivery"}
          </DialogTitle>
          <DialogDescription>
            Milk you bought. Leave a session empty if it didn&apos;t happen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="delivery-date">Date</Label>
            <SaleDatePicker value={date} onChange={setDate} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="delivery-morning">Morning (litres)</Label>
              <Input
                id="delivery-morning"
                value={morning}
                onChange={(event) => setMorning(event.target.value)}
                placeholder="—"
                inputMode="decimal"
                className="num h-11 rounded-lg"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delivery-evening">Evening (litres)</Label>
              <Input
                id="delivery-evening"
                value={evening}
                onChange={(event) => setEvening(event.target.value)}
                placeholder="—"
                inputMode="decimal"
                className="num h-11 rounded-lg"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delivery-rate">Rate per litre</Label>
            <Input
              id="delivery-rate"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              placeholder="e.g. 210"
              inputMode="decimal"
              className="num h-11 rounded-lg"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delivery-notes">Notes (optional)</Label>
            <Input
              id="delivery-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything worth remembering"
              className="h-11 rounded-lg"
              autoComplete="off"
            />
          </div>

          {/* What this comes to, before saving. Display only — the stored total
              is always the server's (computeDeliveryTotals). */}
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-3">
            <span className="num text-sm text-zinc-500">
              {totalLiters > 0 && litersOk ? formatLiters(totalLiters) : "—"}
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
              "Record delivery"
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
