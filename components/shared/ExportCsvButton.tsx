"use client";

import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  useExportCSV,
  type ExportType,
} from "@/lib/hooks/use-export-csv";
import { cn } from "@/lib/utils";

/**
 * "Export CSV" — one button, used on every list that has something worth
 * exporting, so the label, the spinner and the failure handling are identical
 * everywhere rather than six near-copies that drift.
 *
 * Design System: 44px tall, spinner + disabled while pending, toast on success
 * and on failure (both come from the hook).
 */
export function ExportCsvButton({
  type,
  dateFrom,
  dateTo,
  label = "Export CSV",
  className,
  disabled,
}: {
  type: ExportType;
  /** Karachi calendar days. Both or neither; balance exports ignore them. */
  dateFrom?: string;
  dateTo?: string;
  label?: string;
  className?: string;
  /** e.g. nothing to export yet. */
  disabled?: boolean;
}) {
  const { exportCsv, isExporting } = useExportCSV();

  return (
    <Button
      type="button"
      variant="outline"
      className={cn("h-11 rounded-lg", className)}
      disabled={isExporting || disabled}
      onClick={() => exportCsv({ type, dateFrom, dateTo })}
    >
      {isExporting ? (
        <>
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          Exporting…
        </>
      ) : (
        <>
          <Download className="mr-2 size-4" aria-hidden />
          {label}
        </>
      )}
    </Button>
  );
}
