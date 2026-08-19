"use client";

import { useState } from "react";
import { toast } from "sonner";

import { SESSION_EXPIRED_MESSAGE, redirectToLogin } from "@/lib/api-client";

/**
 * Downloads a CSV export.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOESN'T USE lib/api-client
 * ---------------------------------------------------------------------------
 * `api-client` exists to unwrap the `{ data, error }` envelope and hand back
 * parsed JSON. A CSV is a file, not an envelope, so it needs its own path —
 * but it keeps the same contract on the way out: a FAILURE still returns the
 * JSON envelope, and this hook checks the content type before treating a
 * response as a file. Without that check a 400 would be saved to disk as a
 * `.csv` containing an error message, which the owner would open in Excel and
 * be baffled by.
 *
 * The timeout is longer than the 15s used for normal requests: an export scans
 * a date range and can legitimately take a while on a cold serverless function,
 * and there is no partial-render fallback the way there is for a list.
 */

const EXPORT_TIMEOUT_MS = 60_000;

/** Must stay in step with `EXPORT_TYPES` in `app/api/reports/export/route.ts`. */
export type ExportType =
  | "milk_deliveries"
  | "milk_purchases"
  | "farmer_balances"
  | "customer_balances"
  // S6: the unified bill, and per-product units sold (#20) with milk on its
  // own line.
  | "sales"
  | "product_sales"
  /** One farmer, one date range — deliveries and purchases. Needs `farmerId`. */
  | "farmer_statement";

export type ExportOptions = {
  type: ExportType;
  /** Karachi calendar days. Both or neither; ignored by the balance exports. */
  dateFrom?: string;
  dateTo?: string;
  /** Overrides the server-suggested filename. */
  filename?: string;
  /** Required by `farmer_statement`; ignored by every other type. */
  farmerId?: string;
};

export function useExportCSV() {
  const [isExporting, setIsExporting] = useState(false);

  async function exportCsv(options: ExportOptions): Promise<void> {
    if (isExporting) return;
    setIsExporting(true);

    const params = new URLSearchParams({ type: options.type });
    if (options.dateFrom && options.dateTo) {
      params.set("dateFrom", options.dateFrom);
      params.set("dateTo", options.dateTo);
    }
    if (options.farmerId) params.set("farmerId", options.farmerId);

    let objectUrl: string | null = null;

    try {
      let response: Response;
      try {
        response = await fetch(`/api/reports/export?${params.toString()}`, {
          signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
        });
      } catch {
        // Offline, DNS, reset, or our own timeout — all the same to the owner.
        toast.error("Can't reach the server. Check your connection.");
        return;
      }

      if (response.status === 401) {
        toast.error(SESSION_EXPIRED_MESSAGE);
        redirectToLogin();
        return;
      }

      // A failure comes back as the usual JSON envelope. Detect it by content
      // type rather than status alone, so an unexpected HTML error page from a
      // proxy is also caught instead of being saved as a spreadsheet.
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!response.ok || !contentType.includes("text/csv")) {
        let message = "Couldn't build the export.";
        try {
          const envelope = (await response.json()) as { error?: string };
          if (envelope?.error) message = envelope.error;
        } catch {
          // Not JSON either — keep the generic message.
        }
        toast.error(message);
        return;
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        toast.error("The export came back empty. Please try again.");
        return;
      }

      // Prefer the server's filename; it already carries the type and date.
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^"]+)"?/.exec(disposition);
      const filename =
        options.filename ?? match?.[1] ?? `${options.type}.csv`;

      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      // Firefox requires the anchor to be in the document for a click to count.
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      toast.success(`Exported ${filename}`);
    } finally {
      // Runs even on an early return, so the button can never stick disabled —
      // the same trap the offline Save button fell into in Phase 3.2.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsExporting(false);
    }
  }

  return { exportCsv, isExporting };
}
