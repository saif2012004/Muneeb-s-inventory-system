"use client";

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatPickedDate, toDateKey } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A From/To day range that reads DD/MM/YYYY (CHECKLIST #12).
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `<input type="date">`
 * ---------------------------------------------------------------------------
 * A native date input renders in the DEVICE's locale, which no formatter of
 * ours controls. On this machine it shows **mm/dd/yyyy** — so the sales filters
 * read American while every date the app itself prints is DD/MM/YYYY, and the
 * owner is left deciding whether `08/14` is 8 August or 14 August. On a bill
 * that ambiguity is not cosmetic.
 *
 * This uses the same `Calendar` + `formatPickedDate` the sale form's date picker
 * uses, so every date on the screen is written the one way.
 *
 * Values stay `yyyy-MM-dd` strings at the boundary, exactly as before, because
 * that is what the API's Karachi-day filters expect — only the DISPLAY changed.
 *
 * ⚠️ Applied to the UNIFIED sales list only. The per-module lists retire at S9;
 * polishing a screen scheduled for deletion is work thrown away.
 */
export function DateRangeFilter({
  from,
  to,
  invalid,
  onChange,
}: {
  /** `yyyy-MM-dd`, or "" for unset. */
  from: string;
  to: string;
  invalid?: boolean;
  onChange: (next: { from?: string; to?: string }) => void;
}) {
  return (
    <>
      <DayField
        id="filter-from"
        label="From"
        value={from}
        invalid={invalid}
        onPick={(value) => onChange({ from: value })}
      />
      <DayField
        id="filter-to"
        label="To"
        value={to}
        invalid={invalid}
        onPick={(value) => onChange({ to: value })}
      />
    </>
  );
}

function DayField({
  id,
  label,
  value,
  invalid,
  onPick,
}: {
  id: string;
  label: string;
  value: string;
  invalid?: boolean;
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // `yyyy-MM-dd` parsed as a LOCAL day, not through `new Date(string)` — that
  // parses a bare date as UTC and can land the calendar on the previous day.
  const selected = value
    ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
    : undefined;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              aria-invalid={invalid || undefined}
              className={cn(
                "num h-11 flex-1 justify-start rounded-lg font-normal",
                !selected && "text-zinc-500",
                invalid && "border-rose-400 focus-visible:ring-rose-400"
              )}
            >
              <CalendarDays className="mr-2 size-4 shrink-0 opacity-60" aria-hidden />
              {selected ? formatPickedDate(selected) : "Any date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(date) => {
                if (!date) return;
                onPick(toDateKey(date));
                setOpen(false);
              }}
              autoFocus
            />
          </PopoverContent>
        </Popover>

        {/* Clearing ONE end of the range without clearing the other — the
            native input gave this for free and a picker does not. */}
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            className="size-11 shrink-0 rounded-lg p-0 text-zinc-400 hover:text-zinc-900"
            onClick={() => onPick("")}
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Clear {label.toLowerCase()} date</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
