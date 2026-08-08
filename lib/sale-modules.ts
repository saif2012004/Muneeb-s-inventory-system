/**
 * What distinguishes one sale module from another.
 *
 * Beverages and Bakery are the same screen with different nouns: same tables
 * (column-for-column — verified against the live schema), same price-snapshot
 * rule, same list/filter/expand/delete behaviour. The ONLY differences are the
 * endpoint, the catalog category, the accent colour and a few words.
 *
 * So there is one set of components, parameterised by this config, rather than
 * two sets that drift. Adding Milk sales later should mean adding a row here,
 * not another copy of the form.
 *
 * Deliberately dependency-free (no Prisma, no server imports) so client
 * components and route handlers can both read it.
 */
import type { AccentKey } from "@/lib/nav";
import type { ModuleKey } from "@/lib/modules";

export type SaleModule = {
  /** Matches the key in lib/modules.ts, so the server can resolve the category. */
  key: ModuleKey;
  /** "Beverages" — used in headings and in server-side error messages. */
  label: string;
  /** Design System module accent. Never mix two on one screen. */
  accent: AccentKey;
  /** Base path for this module's sale endpoints. */
  apiBase: string;
  /** Where the sales list lives. */
  listRoute: string;
  /** Where the new-sale form lives. */
  newSaleRoute: string;
  /** Sub-copy under the page title on the list screen. */
  listDescription: string;
  /** Sub-copy under the page title on the form. */
  formDescription: string;
  /** Empty-state copy when the module has no sales at all. */
  emptyTitle: string;
  /**
   * CSV export type for this module's sales list.
   *
   * Lives on the config rather than as a branch inside the shared list, for the
   * same reason everything else here does: the list must not learn which module
   * it is rendering.
   */
  exportType: "beverages_sales" | "bakery_sales";
};

export const BEVERAGES_MODULE: SaleModule = {
  key: "beverages",
  label: "Beverages",
  accent: "blue",
  apiBase: "/api/beverages/sales",
  listRoute: "/beverages",
  newSaleRoute: "/beverages/new-sale",
  listDescription: "Sales recorded for the Pepsi agency.",
  formDescription:
    "Beverages. Prices default to the catalog and can be changed per sale.",
  emptyTitle: "No sales yet",
  exportType: "beverages_sales",
};

export const BAKERY_MODULE: SaleModule = {
  key: "bakery",
  label: "Bakery",
  accent: "amber",
  apiBase: "/api/bakery/sales",
  listRoute: "/bakery",
  newSaleRoute: "/bakery/new-sale",
  listDescription: "Cake rusk, buns, biscuits, russ and eggs.",
  formDescription:
    "Bakery. Prices default to the catalog and can be changed per sale.",
  emptyTitle: "No sales yet",
  exportType: "bakery_sales",
};

/** Accent-matched classes for the module's primary button. */
export const MODULE_BUTTON_CLASS: Record<AccentKey, string> = {
  zinc: "bg-zinc-900 hover:bg-zinc-800",
  blue: "bg-blue-600 hover:bg-blue-700",
  amber: "bg-amber-600 hover:bg-amber-700",
  emerald: "bg-emerald-600 hover:bg-emerald-700",
};

/** Accent-matched focus ring, for controls the module owns. */
export const MODULE_RING_CLASS: Record<AccentKey, string> = {
  zinc: "focus-visible:ring-zinc-900",
  blue: "focus-visible:ring-blue-600",
  amber: "focus-visible:ring-amber-600",
  emerald: "focus-visible:ring-emerald-600",
};
