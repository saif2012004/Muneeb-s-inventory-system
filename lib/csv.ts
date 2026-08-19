/**
 * CSV generation. Dependency-free by design — this is a few dozen lines of
 * well-specified string handling, and RFC 4180 is short.
 *
 * The rules that actually matter for this app, because the owner types
 * free-form names and notes:
 *
 *   - A value containing a COMMA must be quoted, or it shifts every column
 *     after it and the spreadsheet silently misreads the row. "Ali, Sons" is a
 *     perfectly ordinary customer name.
 *   - A value containing a DOUBLE QUOTE must be quoted, with each internal
 *     quote doubled (`"` -> `""`).
 *   - A value containing a NEWLINE must be quoted, or one record becomes two.
 *     Notes fields are exactly where this happens.
 */

/** Characters that force quoting under RFC 4180. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Leading characters a spreadsheet may treat as the start of a FORMULA rather
 * than text — the CSV-injection vector.
 *
 * `-` is deliberately NOT in this list. Money in these exports is written as a
 * plain number so it can be summed, and a negative balance legitimately starts
 * with `-`; guarding it would turn -3000 into text and break the arithmetic the
 * export exists for. The guard is applied to STRING fields only, for the same
 * reason.
 */
const FORMULA_LEAD = /^[=+@]/;

/** A cell value before it is stringified. */
export type CsvValue = string | number | null | undefined;

/**
 * One field, escaped. Numbers pass through untouched so they stay numeric in
 * the spreadsheet; strings get the quoting and formula guard.
 */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "number") {
    // NaN/Infinity would render as "NaN" and poison a column of sums.
    return Number.isFinite(value) ? String(value) : "";
  }

  // A leading ' keeps the spreadsheet from evaluating the cell. Applied before
  // quoting so the guard itself ends up inside the quotes.
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;

  if (!NEEDS_QUOTING.test(guarded)) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * A full CSV document.
 *
 * CRLF line endings per RFC 4180 — Excel on Windows is the target and it is the
 * safer choice everywhere else too.
 *
 * The leading BOM is deliberate: without it Excel opens a UTF-8 file as the
 * local ANSI codepage, and non-ASCII names come out as mojibake. Every other
 * spreadsheet handles the BOM fine.
 */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvField).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * A `Content-Disposition` value with a filesystem-safe filename.
 * Quotes and path separators in a filename break the header or the download.
 */
export function csvAttachmentHeader(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `attachment; filename="${safe}"`;
}


/**
 * ⚠️ `toSectionedCsv` was here and is GONE (2026-08-19).
 *
 * It rendered the farmer statement as titled CSV blocks. The owner's verdict on
 * the result was fair — "no columns spaced properly, all the text is same" —
 * and that is not a bug in the renderer, it is what CSV is: plain text with no
 * font, weight, colour, width or number format.
 *
 * The statement is now a real `.xlsx` (`lib/milk-statement-xlsx.ts`). If another
 * multi-section DOCUMENT is ever needed, build a workbook — do not bring this
 * back and expect it to look like one.
 */
