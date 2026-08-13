/**
 * How a balance READS. The arithmetic lives in lib/receivables.ts (server); this
 * is only presentation, and it is shared so the hub, the profile and any future
 * report describe the same number the same way.
 *
 * Design System semantic money colours:
 *   rose    = money owed BY others  -> a customer who owes the owner
 *   emerald = money owed TO others  -> the owner holds the customer's credit
 *   zinc    = neutral / settled
 */
import type { MoneyTone } from "@/components/shared/MoneyText";

export type BalanceTone = "owed" | "settled" | "credit";

export function balanceTone(outstanding: number): BalanceTone {
  if (outstanding > 0) return "owed";
  if (outstanding < 0) return "credit";
  return "settled";
}

/**
 * A NEGATIVE outstanding is not an error — the customer paid more than they
 * were billed. Showing "-Rs. 500" in a column headed "Outstanding" reads like a
 * bug; "Rs. 500 credit" reads like what it is. So the magnitude is displayed
 * and the sign is carried by the word and the colour.
 */
export function balanceLabel(outstanding: number): string {
  const tone = balanceTone(outstanding);
  if (tone === "owed") return "Owes";
  if (tone === "credit") return "In credit";
  return "Settled";
}

/** The number to DISPLAY — magnitude only; the label carries the direction. */
export function balanceMagnitude(outstanding: number): number {
  return Math.abs(outstanding);
}

export function balanceMoneyTone(outstanding: number): MoneyTone {
  const tone = balanceTone(outstanding);
  if (tone === "owed") return "rose";
  if (tone === "credit") return "emerald";
  return "zinc";
}

/** Text colour for a label sitting next to the figure. */
export const BALANCE_TEXT_CLASS: Record<BalanceTone, string> = {
  owed: "text-rose-600",
  credit: "text-emerald-600",
  settled: "text-zinc-500",
};

/** Module accent for a purchase row, matching the sidebar and each module. */
export const MODULE_DOT_CLASS: Record<string, string> = {
  beverages: "bg-blue-600",
  bakery: "bg-amber-600",
  milk: "bg-emerald-600",
  /**
   * A cross-module bill wears ZINC, not one of the three accents. The Design
   * System's rule is never to mix module accents, and a bill that may hold
   * beverage, bakery and milk lines has no single one to claim — painting it
   * blue would say "beverages sale" about a row that is not.
   */
  unified: "bg-zinc-900",
};

export const MODULE_LABEL: Record<string, string> = {
  beverages: "Beverages",
  bakery: "Bakery",
  milk: "Milk",
  unified: "Sale",
};

/**
 * Where a purchase row links, or null for one with no detail screen.
 *
 * A map rather than `/${module}`: milk has no sale detail page, and "unified"
 * would otherwise build `/unified`, which does not exist.
 */
export const MODULE_HREF: Record<string, string | null> = {
  beverages: "/beverages",
  bakery: "/bakery",
  milk: null,
  unified: "/sales",
};
