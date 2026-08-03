"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatPickedDate, karachiToday } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sale date picker. Displays DD/MM/YYYY per the Design System; the caller
 * converts to `yyyy-MM-dd` on submit via `toDateKey`.
 *
 * The value is a calendar DAY, not an instant — see the note above
 * `karachiToday()` in lib/format.ts for why this formats locally rather than
 * converting through Asia/Karachi.
 */
export function SaleDatePicker({
  value,
  onChange,
  invalid,
}: {
  value: Date | undefined;
  onChange: (date: Date) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const today = karachiToday();

  return (
    // A Popover renders only its trigger, and the trigger is an inline-flex
    // Button — so without this wrapper the <label> and the field sat on the SAME
    // LINE, because `space-y-*` cannot stack inline-level siblings. Every other
    // field in the form supplies a block child; this makes Date match.
    <div className="block">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-11 w-full justify-start rounded-lg font-normal sm:w-[200px]",
              !value && "text-zinc-500",
              invalid && "border-rose-400 focus-visible:ring-rose-400"
            )}
          >
            <CalendarDays
              className="mr-2 size-4 shrink-0 opacity-70"
              aria-hidden
            />
            <span className="num">
              {value ? formatPickedDate(value) : "Pick a date"}
            </span>
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            defaultMonth={value ?? today}
            onSelect={(date) => {
              if (!date) return;
              onChange(date);
              setOpen(false);
            }}
            // A sale cannot be recorded in the future. Karachi's "today", not
            // the browser's — near midnight PKT those differ.
            disabled={{ after: today }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
