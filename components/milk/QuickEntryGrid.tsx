"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, LogIn, RefreshCw, Users, Zap } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { MoneyText } from "@/components/shared/MoneyText";
import { PageHeader } from "@/components/shared/PageHeader";
import { SaleDatePicker } from "@/components/sales/SaleDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatLiters, karachiToday, toDateKey } from "@/lib/format";
import {
  useQuickEntryDay,
  useSaveQuickEntry,
  type QuickEntryRow,
} from "@/lib/hooks/use-milk";
import { MODULE_BUTTON_CLASS } from "@/lib/sale-modules";
import { cn } from "@/lib/utils";

/**
 * QUICK ENTRY — one date, every farmer, one save.
 *
 * The screen the milk module exists for. Twice a day the owner stands at the
 * shop while farmers arrive; a separate form per farmer, each with its own date
 * and rate, is not something anyone completes twice a day.
 *
 * THE GRID IS THE DAY. It loads prefilled with whatever is already recorded for
 * the chosen date, so the evening pass edits the SAME rows the morning pass
 * created rather than making second ones.
 *
 * Everything typed here is a string until submit. Numeric inputs on Android
 * produce "", "1.", "1..2" and pasted junk; keeping the raw text means the
 * owner's half-typed "1." is not silently rewritten under the cursor, and the
 * parse happens once, deliberately, when they save.
 */

type RowState = {
  morning: string;
  evening: string;
  rate: string;
};

/** "" -> null (nothing entered); anything else -> a number, possibly NaN. */
function toLiters(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

function isBadNumber(value: number | null): boolean {
  return value !== null && (Number.isNaN(value) || value < 0);
}

export function QuickEntryGrid() {
  // Karachi's today, never `new Date()` — after 7pm PKT, which is exactly when
  // the evening round happens, the browser's UTC day has already rolled over
  // and the entry would open on tomorrow (Gotcha 4).
  const [date, setDate] = useState<Date>(() => karachiToday());
  const dateKey = toDateKey(date);

  const dayQuery = useQuickEntryDay(dateKey);
  const saveQuickEntry = useSaveQuickEntry();

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [bulkRate, setBulkRate] = useState("");

  /**
   * Bumped after a successful save to FORCE a reseed from the server.
   *
   * Without it the grid can display a number that is not what is stored.
   * TanStack Query uses structural sharing: when a refetch returns data deeply
   * equal to what it already held, it keeps the EXISTING array reference. So
   * after a save that changed nothing for a given farmer — which is exactly
   * what happens when the owner blanks a row, since quick entry never deletes —
   * `serverRows` is reference-identical, the reseed effect below does not run,
   * and the box the owner cleared STAYS cleared while the delivery is still on
   * the books. Found in browser testing; it type-checked and linted clean.
   *
   * Deliberately not keyed on `dataUpdatedAt`, which also changes on background
   * refetches (window focus) and would wipe half-typed litres mid-round.
   */
  const [seedVersion, setSeedVersion] = useState(0);

  const serverRows = useMemo(() => dayQuery.data?.rows ?? [], [dayQuery.data]);

  /**
   * Reseed from the server whenever the day's data arrives or the date changes.
   *
   * Keyed on `dayQuery.data` rather than running once: switching dates must
   * REPLACE the grid, not merge yesterday's typing into today. Local edits to a
   * day are lost on a refetch of that same day, which is correct — the server
   * copy is the saved truth and silently keeping stale boxes over it is how an
   * owner ends up saving a number they thought they had already changed.
   */
  useEffect(() => {
    const next: Record<string, RowState> = {};
    for (const row of serverRows) {
      next[row.farmerId] = {
        morning:
          row.delivery?.morningLiters === null ||
          row.delivery?.morningLiters === undefined
            ? ""
            : String(row.delivery.morningLiters),
        evening:
          row.delivery?.eveningLiters === null ||
          row.delivery?.eveningLiters === undefined
            ? ""
            : String(row.delivery.eveningLiters),
        rate: row.suggestedRate === null ? "" : String(row.suggestedRate),
      };
    }
    setRows(next);
    // `seedVersion` forces this to re-run after a save even when the server
    // returned a reference-identical array — see the note on seedVersion.
  }, [serverRows, seedVersion]);

  function updateRow(farmerId: string, patch: Partial<RowState>) {
    setRows((current) => {
      // A row the seeding effect hasn't reached yet reads as undefined at
      // runtime even though the Record type says otherwise, so fall back to an
      // empty row rather than spreading undefined.
      const existing: RowState = current[farmerId] ?? {
        morning: "",
        evening: "",
        rate: "",
      };
      return { ...current, [farmerId]: { ...existing, ...patch } };
    });
  }

  /** Put one rate on every row. The rate is usually the same for everybody. */
  function applyRateToAll() {
    const rate = bulkRate.trim();
    if (rate === "") return;
    setRows((current) => {
      const next: Record<string, RowState> = {};
      for (const farmerId of Object.keys(current)) {
        next[farmerId] = { ...current[farmerId], rate };
      }
      return next;
    });
    toast.success("Rate applied to every farmer");
  }

  /**
   * The day's running total, for display only.
   *
   * Summing already-parsed numbers held in memory, not deriving a balance from
   * raw rows — the same latitude the customers hub takes. The SAVED totals are
   * always the server's (computeDeliveryTotals), never this.
   */
  const preview = useMemo(() => {
    let liters = 0;
    let amount = 0;
    let farmers = 0;

    for (const row of serverRows) {
      const state = rows[row.farmerId];
      if (!state) continue;

      const morning = toLiters(state.morning);
      const evening = toLiters(state.evening);
      const rate = Number(state.rate);
      const rowLiters = (morning ?? 0) + (evening ?? 0);

      if (Number.isNaN(rowLiters) || rowLiters <= 0) continue;

      farmers += 1;
      liters += rowLiters;
      if (!Number.isNaN(rate)) amount += rowLiters * rate;
    }

    return { liters, amount, farmers };
  }, [rows, serverRows]);

  function save() {
    const entries: {
      farmerId: string;
      morningLiters: number | null;
      eveningLiters: number | null;
      ratePerLiter: number;
    }[] = [];

    for (const row of serverRows) {
      const state = rows[row.farmerId];
      if (!state) continue;

      const morning = toLiters(state.morning);
      const evening = toLiters(state.evening);

      if (isBadNumber(morning) || isBadNumber(evening)) {
        toast.error(`Check the litres for ${row.name}.`);
        return;
      }

      const hasMilk = (morning ?? 0) + (evening ?? 0) > 0;

      // A blank row for a farmer who has nothing stored is simply someone who
      // did not come today — not an error, and nothing to send.
      if (!hasMilk && !row.delivery) continue;

      const rate = Number(state.rate.trim());
      if (!state.rate.trim() || Number.isNaN(rate) || rate <= 0) {
        toast.error(`Enter a rate for ${row.name}.`);
        return;
      }

      entries.push({
        farmerId: row.farmerId,
        morningLiters: morning,
        eveningLiters: evening,
        ratePerLiter: rate,
      });
    }

    if (entries.length === 0) {
      toast.error("Enter litres for at least one farmer.");
      return;
    }

    saveQuickEntry.mutate(
      { deliveryDate: dateKey, entries },
      {
        onSuccess: (result) => {
          // Re-seed every box from what the server actually stored. Runs after
          // the hook's invalidation has settled, so `serverRows` is fresh by
          // the time the effect fires.
          setSeedVersion((current) => current + 1);

          const parts: string[] = [];
          if (result.created > 0) parts.push(`${result.created} added`);
          if (result.updated > 0) parts.push(`${result.updated} updated`);
          toast.success(
            parts.length > 0 ? `Saved — ${parts.join(", ")}` : "Nothing to save"
          );

          // Quick entry never deletes. Saying so out loud is the whole point:
          // silently ignoring a cleared row would show a success toast while
          // the delivery the owner just wiped is still on the books.
          if (result.clearedButKept.length > 0) {
            const names = result.clearedButKept
              .map((entry) => entry.name)
              .join(", ");
            toast.warning(
              `Cleared boxes are not deletions. ${names} still ${result.clearedButKept.length === 1 ? "has a delivery" : "have deliveries"} recorded for this date — open the farmer to delete it.`,
              { duration: 10_000 }
            );
          }
        },
        onError: (error) => {
          if (error instanceof ApiError && error.isSessionExpired) {
            toast.error(error.message);
            redirectToLogin();
            return;
          }
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Couldn't save the deliveries."
          );
        },
      }
    );
  }

  const header = (
    <>
      <Link
        href="/milk"
        className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Milk shop
      </Link>
      <PageHeader
        title="Quick entry"
        accent="emerald"
        description="One date, every farmer. Morning and evening go on the same row."
      />
    </>
  );

  // ------------------------------------------------------------------
  // Session / error states
  // ------------------------------------------------------------------

  if (dayQuery.error instanceof ApiError && dayQuery.error.isSessionExpired) {
    return (
      <>
        {header}
        <EmptyState
          icon={LogIn}
          accent="emerald"
          title="Your session expired"
          description="Please sign in again to record deliveries."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  if (dayQuery.error) {
    return (
      <>
        {header}
        <EmptyState
          icon={RefreshCw}
          accent="emerald"
          title="Couldn't load the day"
          description={
            dayQuery.error instanceof ApiError
              ? dayQuery.error.message
              : "Something went wrong."
          }
          action={
            <Button className="h-11 rounded-lg" onClick={() => dayQuery.refetch()}>
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}

      {/* Day + rate controls ------------------------------------------ */}
      <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="quick-entry-date">Date</Label>
            <SaleDatePicker value={date} onChange={setDate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-entry-rate">Rate for everyone</Label>
            <div className="flex gap-2">
              <Input
                id="quick-entry-rate"
                value={bulkRate}
                onChange={(event) => setBulkRate(event.target.value)}
                placeholder="e.g. 210"
                // Design System: numeric inputs use the decimal keypad.
                inputMode="decimal"
                className="num h-11 w-28 rounded-lg"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-lg"
                disabled={!bulkRate.trim() || serverRows.length === 0}
                onClick={applyRateToAll}
              >
                Apply to all
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm text-zinc-500">
          Leave a farmer blank if they didn&apos;t come. Blank never deletes an
          entry that&apos;s already saved.
        </p>
      </div>

      {/* Rows ---------------------------------------------------------- */}
      {dayQuery.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[132px] w-full rounded-xl" />
          ))}
        </div>
      ) : serverRows.length === 0 ? (
        <EmptyState
          icon={Users}
          accent="emerald"
          title="No farmers yet"
          description="Add the farmers who deliver to you, then come back here each morning and evening."
          action={
            <Button
              asChild
              className={cn("h-11 rounded-lg", MODULE_BUTTON_CLASS.emerald)}
            >
              <Link href="/milk">Go to farmers</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3 pb-28">
          {serverRows.map((row) => (
            <QuickEntryCard
              key={row.farmerId}
              row={row}
              state={
                rows[row.farmerId] ?? { morning: "", evening: "", rate: "" }
              }
              onChange={(patch) => updateRow(row.farmerId, patch)}
            />
          ))}
        </div>
      )}

      {/* Sticky save bar ---------------------------------------------
          Fixed to the bottom so the owner never has to scroll a long list of
          farmers back to the top to save. `bottom-[68px]` clears the mobile
          bottom nav (min-h-56px plus its safe-area padding), matching the sale
          form's total bar.

          `md:left-60` — NOT `inset-x-0` with padding. The sidebar is `w-60` and
          fixed, so a full-width bar's BACKGROUND still runs underneath it even
          when its contents are padded clear; Phase 3.2 shipped exactly that and
          the bar covered the sidebar's Log out button (FAIL-1). Constraining
          the left EDGE is what actually keeps the sidebar clickable. */}
      {serverRows.length > 0 ? (
        <div className="fixed inset-x-0 bottom-[68px] z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:left-60">
          <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3 md:max-w-none">
            <div className="min-w-0">
              <p className="num text-sm text-zinc-500">
                {preview.farmers}{" "}
                {preview.farmers === 1 ? "farmer" : "farmers"} ·{" "}
                {formatLiters(preview.liters)}
              </p>
              <MoneyText
                value={preview.amount}
                tone="emerald"
                className="text-[17px] font-semibold"
              />
            </div>

            <Button
              className={cn(
                "h-11 shrink-0 rounded-lg px-6",
                MODULE_BUTTON_CLASS.emerald
              )}
              disabled={saveQuickEntry.isPending}
              onClick={save}
            >
              {saveQuickEntry.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                <>
                  <Zap className="mr-2 size-4" aria-hidden />
                  Save day
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One farmer's row: morning, evening, rate, and what that comes to. */
function QuickEntryCard({
  row,
  state,
  onChange,
}: {
  row: QuickEntryRow;
  state: RowState;
  onChange: (patch: Partial<RowState>) => void;
}) {
  const morning = toLiters(state.morning);
  const evening = toLiters(state.evening);
  const rate = Number(state.rate);
  const liters = (morning ?? 0) + (evening ?? 0);
  const amount =
    Number.isNaN(liters) || Number.isNaN(rate) ? 0 : liters * rate;

  const invalid = isBadNumber(morning) || isBadNumber(evening);

  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-4 shadow-sm",
        invalid ? "border-rose-300" : "border-zinc-200"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-zinc-900">
            {row.name}
          </p>
          {row.delivery ? (
            // Says plainly that this row is an EDIT, not a new entry — otherwise
            // the evening pass looks identical to the morning one and it is not
            // obvious the two share a row.
            <p className="mt-0.5 text-xs text-emerald-600">
              Already recorded for this date
            </p>
          ) : null}
        </div>
        {liters > 0 ? (
          <div className="shrink-0 text-right">
            <MoneyText
              value={amount}
              tone="emerald"
              className="text-[15px] font-semibold"
            />
            <p className="num mt-0.5 text-xs text-zinc-500">
              {formatLiters(liters)}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label
            htmlFor={`morning-${row.farmerId}`}
            className="text-[13px] font-medium text-zinc-500"
          >
            Morning
          </Label>
          <Input
            id={`morning-${row.farmerId}`}
            value={state.morning}
            onChange={(event) => onChange({ morning: event.target.value })}
            placeholder="—"
            inputMode="decimal"
            className="num h-11 rounded-lg text-center"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor={`evening-${row.farmerId}`}
            className="text-[13px] font-medium text-zinc-500"
          >
            Evening
          </Label>
          <Input
            id={`evening-${row.farmerId}`}
            value={state.evening}
            onChange={(event) => onChange({ evening: event.target.value })}
            placeholder="—"
            inputMode="decimal"
            className="num h-11 rounded-lg text-center"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor={`rate-${row.farmerId}`}
            className="text-[13px] font-medium text-zinc-500"
          >
            Rate
          </Label>
          <Input
            id={`rate-${row.farmerId}`}
            value={state.rate}
            onChange={(event) => onChange({ rate: event.target.value })}
            placeholder="—"
            inputMode="decimal"
            className="num h-11 rounded-lg text-center"
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}
