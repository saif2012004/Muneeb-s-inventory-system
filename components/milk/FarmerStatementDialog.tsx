"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";

import { DateRangeFilter } from "@/components/sales/DateRangeFilter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useExportCSV } from "@/lib/hooks/use-export-csv";
import { MODULE_BUTTON_CLASS } from "@/lib/nav";

/**
 * THE FARMER STATEMENT — pick a farmer, pick the dates, download a spreadsheet.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPLACED THE PLAIN "Export" BUTTON
 * ---------------------------------------------------------------------------
 * `/milk/balances` used to export `farmer_balances`: every farmer, one row each,
 * no date range and no detail. That answers "what do I owe everyone right now",
 * which the screen already shows — it does not answer the question the owner
 * actually has, which is "print what I bought from THIS farmer between THESE
 * dates so we can settle up".
 *
 * The balances export still exists in the API and is unchanged; it simply is not
 * the button on this screen any more.
 *
 * ---------------------------------------------------------------------------
 * NO DATES = ALL TIME, and that is deliberate
 * ---------------------------------------------------------------------------
 * The range is OPTIONAL. Leaving both blank exports the farmer's whole history,
 * which is what you want the first time you settle with someone. The server
 * enforces the pairing — one date without the other is a 400 — so a half-filled
 * range can never quietly become "since the beginning of time".
 */
export function FarmerStatementDialog({
  farmers,
  accent = "emerald",
}: {
  farmers: { id: string; name: string; isActive: boolean }[];
  accent?: "emerald" | "zinc";
}) {
  const [open, setOpen] = useState(false);
  const [farmerId, setFarmerId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { exportCsv, isExporting } = useExportCSV();

  /**
   * Caught HERE, before the request goes out. The owner routinely moves "From"
   * past the current "To" while adjusting a range; the server rightly 400s that,
   * but a round trip to be told so is worse than the button simply staying
   * disabled with the reason on screen.
   */
  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  // Both or neither — the same rule the server enforces, surfaced early.
  const halfRange = Boolean(dateFrom) !== Boolean(dateTo);

  function reset() {
    setFarmerId("");
    setDateFrom("");
    setDateTo("");
  }

  async function download() {
    if (!farmerId || invalidRange || halfRange) return;
    await exportCsv({
      type: "farmer_statement",
      farmerId,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
    setOpen(false);
    reset();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 rounded-lg"
        onClick={() => setOpen(true)}
        disabled={farmers.length === 0}
      >
        <FileSpreadsheet className="mr-2 size-4" aria-hidden />
        Farmer statement
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Farmer statement</DialogTitle>
            <DialogDescription>
              Milk delivered and purchases taken, sorted by date, as a
              spreadsheet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="statement-farmer">Farmer</Label>
              <select
                id="statement-farmer"
                value={farmerId}
                onChange={(event) => setFarmerId(event.target.value)}
                className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                <option value="">Choose a farmer…</option>
                {farmers.map((farmer) => (
                  <option key={farmer.id} value={farmer.id}>
                    {/* Retired farmers stay selectable: retiring someone does
                        not settle what they are owed, and a final statement is
                        exactly what you print for them. */}
                    {farmer.name}
                    {farmer.isActive ? "" : " (retired)"}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* The same picker the sales screen uses, so the dates read
                  DD/MM/YYYY rather than whatever the device's locale imposes on
                  a native date input (CHECKLIST #12). */}
              <DateRangeFilter
                from={dateFrom}
                to={dateTo}
                invalid={invalidRange}
                onChange={(next) => {
                  if (next.from !== undefined) setDateFrom(next.from);
                  if (next.to !== undefined) setDateTo(next.to);
                }}
              />
            </div>

            {invalidRange ? (
              <p className="text-sm text-rose-600">
                The start date must be on or before the end date.
              </p>
            ) : halfRange ? (
              <p className="text-sm text-rose-600">
                Give both dates, or leave both blank for the whole history.
              </p>
            ) : (
              <p className="text-sm text-zinc-500">
                {dateFrom && dateTo
                  ? "Only records between these dates will be included."
                  : "No dates chosen — the statement will cover everything."}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-lg"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className={`h-11 rounded-lg ${MODULE_BUTTON_CLASS[accent]}`}
              onClick={download}
              disabled={!farmerId || invalidRange || halfRange || isExporting}
            >
              {isExporting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Preparing…
                </>
              ) : (
                <>
                  <Download className="mr-2 size-4" aria-hidden />
                  Download
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
