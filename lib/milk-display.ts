/**
 * How a FARMER balance READS. The arithmetic lives in lib/milk.ts (server-only —
 * it imports Prisma); this is presentation only, and it is dependency-free so
 * client components can import it without dragging Prisma into the browser
 * bundle. Same split as lib/receivables.ts / lib/receivables-display.ts.
 *
 * ---------------------------------------------------------------------------
 * THE SIGN IS THE OPPOSITE WAY ROUND FROM A CUSTOMER BALANCE
 * ---------------------------------------------------------------------------
 * Customers: positive outstanding    = the customer owes the OWNER  -> rose.
 * Farmers:   positive netBalanceOwed = the OWNER owes the FARMER    -> emerald.
 *
 * Both are positive numbers about money and they point in opposite directions.
 * Design System semantic colours are defined by DIRECTION, not by sign:
 *   emerald = money owed TO others -> what the owner must pay a farmer
 *   rose    = money owed BY others -> a farmer who has taken more than they're owed
 *   zinc    = neutral / settled
 *
 * Reusing the customer helpers here would paint every unpaid farmer rose, i.e.
 * as if the farmer were in debt — backwards, and backwards in the direction
 * that makes the owner think a bill is already settled.
 */
import type { MoneyTone } from "@/components/shared/MoneyText";

export type FarmerBalanceTone = "owed" | "settled" | "advance";

export function farmerBalanceTone(netBalanceOwed: number): FarmerBalanceTone {
  if (netBalanceOwed > 0) return "owed";
  if (netBalanceOwed < 0) return "advance";
  return "settled";
}

/**
 * A NEGATIVE net balance is not an error — the farmer has taken more in goods
 * than their milk is worth so far, so they are running ahead. "-Rs. 500" under
 * a heading of "Owed" reads like a bug; "Rs. 500 ahead" reads like what it is.
 * The magnitude is displayed and the direction is carried by the word and the
 * colour.
 */
export function farmerBalanceLabel(netBalanceOwed: number): string {
  const tone = farmerBalanceTone(netBalanceOwed);
  if (tone === "owed") return "You owe";
  if (tone === "advance") return "Ahead";
  return "Settled";
}

/** The number to DISPLAY — magnitude only; the label carries the direction. */
export function farmerBalanceMagnitude(netBalanceOwed: number): number {
  return Math.abs(netBalanceOwed);
}

export function farmerBalanceMoneyTone(netBalanceOwed: number): MoneyTone {
  const tone = farmerBalanceTone(netBalanceOwed);
  if (tone === "owed") return "emerald";
  if (tone === "advance") return "rose";
  return "zinc";
}

/** Text colour for a label sitting next to the figure. */
export const FARMER_BALANCE_TEXT_CLASS: Record<FarmerBalanceTone, string> = {
  owed: "text-emerald-600",
  advance: "text-rose-600",
  settled: "text-zinc-500",
};

/**
 * A missing session is NOT zero litres.
 *
 * `null` means the farmer did not come for that session; `0` means they came
 * and brought nothing. The columns are nullable precisely to keep those apart
 * (see serializeLiters in lib/serialize.ts), so an em dash is shown rather than
 * "0 L" — otherwise every skipped morning would look like a farmer who turned
 * up empty-handed.
 */
export function formatSessionLiters(value: number | null): string {
  if (value === null) return "—";
  return `${Number(value.toFixed(2))} L`;
}

export const SESSION_LABELS = {
  morning: "Morning",
  evening: "Evening",
} as const;
