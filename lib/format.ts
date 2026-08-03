/**
 * Formatting + Asia/Karachi date helpers. See Gotcha 4 in CLAUDE.md.
 *
 * Vercel serverless functions run in UTC. The owner logs morning and evening
 * deliveries in Pakistan time, so a delivery entered near midnight PKT lands on
 * the wrong calendar day if you bucket it with a bare `new Date()`.
 *
 * Rule: timestamps are stored in UTC; "today", range filters and day grouping
 * are all computed in Asia/Karachi.
 */
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const KARACHI_TZ = "Asia/Karachi";

// Pakistan's week runs Monday..Sunday; date-fns defaults to Sunday.
const WEEK_STARTS_ON = 1 as const;

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

// "en-US" rather than "en-PK" so grouping is always 3-digit (1,250,000).
// Some ICU builds give en-PK South Asian grouping (12,50,000), which would make
// column widths inconsistent between the owner's phone and the server.
const PKR = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const PKR_PRECISE = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * `formatPKR(1250)` -> `"Rs. 1,250"`.
 *
 * Takes a number, never a Decimal — serialize at the API boundary first.
 * Pass `{ precise: true }` for the two-decimal form where paise matter.
 */
export function formatPKR(
  value: number | null | undefined,
  options?: { precise?: boolean }
): string {
  const n = value ?? 0;
  return `Rs. ${(options?.precise ? PKR_PRECISE : PKR).format(n)}`;
}

/** `formatLiters(12.5)` -> `"12.5 L"`. Trailing zeroes are dropped. */
export function formatLiters(value: number | null | undefined): string {
  const n = value ?? 0;
  return `${Number(n.toFixed(2))} L`;
}

/** `formatDate(d)` -> `"03/08/2026"` (DD/MM/YYYY, in Karachi time). */
export function formatDate(date: Date | string): string {
  return formatInTimeZone(toDate(date), KARACHI_TZ, "dd/MM/yyyy");
}

/** `"03/08/2026, 6:45 pm"` — for timestamps where the time matters. */
export function formatDateTime(date: Date | string): string {
  return formatInTimeZone(toDate(date), KARACHI_TZ, "dd/MM/yyyy, h:mm a");
}

/**
 * Stable `"yyyy-MM-dd"` key for grouping rows into Karachi calendar days.
 * Use this for chart buckets and day-by-day tables, never `toISOString()`,
 * which would bucket by UTC day and split Karachi evenings across two days.
 */
export function karachiDayKey(date: Date | string): string {
  return formatInTimeZone(toDate(date), KARACHI_TZ, "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// Karachi date maths
//
// Each helper returns a UTC instant that corresponds to a Karachi wall-clock
// boundary, so the results drop straight into Prisma `where` clauses.
// ---------------------------------------------------------------------------

function toDate(date: Date | string): Date {
  return typeof date === "string" ? new Date(date) : date;
}

/** The UTC instant of 00:00:00 Karachi on the given date's Karachi day. */
export function startOfKarachiDay(date: Date | string = new Date()): Date {
  const wallClock = toZonedTime(toDate(date), KARACHI_TZ);
  return fromZonedTime(startOfDay(wallClock), KARACHI_TZ);
}

/**
 * The UTC instant of 00:00:00 Karachi on the FOLLOWING day — i.e. the
 * exclusive upper bound of the given Karachi day.
 */
export function endOfKarachiDay(date: Date | string = new Date()): Date {
  const wallClock = toZonedTime(toDate(date), KARACHI_TZ);
  return fromZonedTime(startOfDay(addDays(wallClock, 1)), KARACHI_TZ);
}

/** Start of the current Karachi day, as a UTC instant. */
export function todayInKarachi(): Date {
  return startOfKarachiDay(new Date());
}

/** Today's Karachi calendar date as `"yyyy-MM-dd"`. */
export function todayKeyInKarachi(): string {
  return karachiDayKey(new Date());
}

// ---------------------------------------------------------------------------
// Calendar-day pickers
//
// A date PICKER deals in calendar days, not instants. shadcn's Calendar hands
// back a Date at LOCAL midnight for the day the owner clicked, and that day —
// not the underlying instant — is what they meant.
//
// So these two deliberately use local formatting rather than
// formatInTimeZone(..., KARACHI_TZ): converting a local-midnight Date into
// Karachi would shift the day for anyone not sitting in Karachi, and show them
// a different date from the one they just tapped. The Karachi part is handled
// where it belongs — `karachiToday()` seeds the picker with the right day, and
// the server turns the `yyyy-MM-dd` key back into a Karachi midnight instant.
// ---------------------------------------------------------------------------

/**
 * Today's Karachi calendar day, as a local Date suitable for `<Calendar>`.
 * Use this to seed a picker, never `new Date()` — near midnight PKT those are
 * different days.
 */
export function karachiToday(): Date {
  const [year, month, day] = todayKeyInKarachi().split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** A picked Date -> the `"yyyy-MM-dd"` key the API expects. */
export function toDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** A picked Date -> `"03/08/2026"` for display next to the picker. */
export function formatPickedDate(date: Date): string {
  return format(date, "dd/MM/yyyy");
}

export type KarachiPeriod =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisYear"
  | "all";

export type DateRange = { start: Date; end: Date };

/**
 * A named period resolved to a half-open UTC range: `start` inclusive, `end`
 * exclusive. Feed it to Prisma as `{ gte: start, lt: end }` — using `lte` would
 * double-count rows landing exactly on midnight.
 *
 *   const { start, end } = karachiRange("thisMonth");
 *   prisma.milkSale.findMany({ where: { saleDate: { gte: start, lt: end } } });
 */
export function karachiRange(
  period: KarachiPeriod,
  now: Date = new Date()
): DateRange {
  const wallClock = toZonedTime(now, KARACHI_TZ);
  const toUtc = (d: Date) => fromZonedTime(d, KARACHI_TZ);

  switch (period) {
    case "today":
      return {
        start: toUtc(startOfDay(wallClock)),
        end: toUtc(startOfDay(addDays(wallClock, 1))),
      };

    case "yesterday":
      return {
        start: toUtc(startOfDay(subDays(wallClock, 1))),
        end: toUtc(startOfDay(wallClock)),
      };

    // Rolling windows include today, so "last 7 days" is today plus the 6 before.
    case "last7":
      return {
        start: toUtc(startOfDay(subDays(wallClock, 6))),
        end: toUtc(startOfDay(addDays(wallClock, 1))),
      };

    case "last30":
      return {
        start: toUtc(startOfDay(subDays(wallClock, 29))),
        end: toUtc(startOfDay(addDays(wallClock, 1))),
      };

    case "thisWeek":
      return {
        start: toUtc(startOfWeek(wallClock, { weekStartsOn: WEEK_STARTS_ON })),
        end: toUtc(
          startOfDay(
            addDays(endOfWeek(wallClock, { weekStartsOn: WEEK_STARTS_ON }), 1)
          )
        ),
      };

    case "thisMonth":
      return {
        start: toUtc(startOfMonth(wallClock)),
        end: toUtc(startOfMonth(addMonths(wallClock, 1))),
      };

    case "lastMonth": {
      const previous = addMonths(wallClock, -1);
      return {
        start: toUtc(startOfMonth(previous)),
        end: toUtc(startOfDay(addDays(endOfMonth(previous), 1))),
      };
    }

    case "thisYear":
      return {
        start: toUtc(startOfYear(wallClock)),
        end: toUtc(startOfDay(addDays(wallClock, 1))),
      };

    case "all":
      return { start: new Date(0), end: toUtc(startOfDay(addDays(wallClock, 1))) };
  }
}
