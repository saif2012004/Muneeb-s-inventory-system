import {
  BarChart2,
  LayoutDashboard,
  Milk,
  Package,
  ReceiptText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for navigation and module accents, shared by Sidebar
 * and BottomNav so the two can never drift.
 *
 * Design System: Beverages = blue, Bakery = amber, Milk = emerald. Everything
 * else is neutral zinc, and only the ACTIVE item wears its accent — that's how
 * "never mix accents on one screen" holds while all modules are listed.
 *
 * Every class below is a complete literal string. Tailwind's JIT scans source
 * text, so a constructed name like `text-${color}-600` would never be emitted.
 */

export const ACCENTS = {
  zinc: {
    text: "text-zinc-900",
    activeBg: "bg-zinc-100",
    icon: "bg-zinc-100 text-zinc-700",
    solid: "bg-zinc-900",
  },
  blue: {
    text: "text-blue-600",
    activeBg: "bg-blue-50",
    icon: "bg-blue-50 text-blue-600",
    solid: "bg-blue-600",
  },
  amber: {
    text: "text-amber-600",
    activeBg: "bg-amber-50",
    icon: "bg-amber-50 text-amber-600",
    solid: "bg-amber-600",
  },
  emerald: {
    text: "text-emerald-600",
    activeBg: "bg-emerald-50",
    icon: "bg-emerald-50 text-emerald-600",
    solid: "bg-emerald-600",
  },
} as const;

export type AccentKey = keyof typeof ACCENTS;

/**
 * Accent-matched classes for a screen's primary button and for the focus ring on
 * controls it owns.
 *
 * They moved here from `lib/sale-modules.ts` in S9, when the per-module sale
 * screens were retired and that file's real subject — a `SaleModule` config of
 * endpoints and copy — went with them. These two maps were the only survivors,
 * and they were never about sales: they are `AccentKey` -> Tailwind, which is
 * exactly what `ACCENTS` above is. Keeping a file called "sale-modules" alive to
 * hold them would have left the codebase implying a sale abstraction that no
 * longer exists.
 *
 * ⚠️ These class strings must appear as LITERALS for Tailwind to keep them —
 * which is why `tailwind.config.ts` has to include `./lib` in its content globs
 * (see the Phase 2 note in CLAUDE.md).
 */
export const MODULE_BUTTON_CLASS: Record<AccentKey, string> = {
  zinc: "bg-zinc-900 hover:bg-zinc-800",
  blue: "bg-blue-600 hover:bg-blue-700",
  amber: "bg-amber-600 hover:bg-amber-700",
  emerald: "bg-emerald-600 hover:bg-emerald-700",
};

export const MODULE_RING_CLASS: Record<AccentKey, string> = {
  zinc: "focus-visible:ring-zinc-900",
  blue: "focus-visible:ring-blue-600",
  amber: "focus-visible:ring-amber-600",
  emerald: "focus-visible:ring-emerald-600",
};

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  accent: AccentKey;
};

/** Full navigation, in sidebar order. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, accent: "zinc" },
  /**
   * The UNIFIED till (S4.2). ZINC, not a module accent: it sells from all three
   * shops on one bill, and the Design System forbids mixing accents on a screen.
   *
   * Placed directly under Dashboard because it is the screen the owner uses
   * most, but the four PRIMARY (thumb-reachable) tabs are deliberately left
   * untouched — reshuffling a nav the owner already knows is a change to make
   * on purpose, not a side effect of adding a screen.
   */
  { href: "/sales", label: "Sales", icon: ReceiptText, accent: "zinc" },
  { href: "/milk", label: "Milk Shop", icon: Milk, accent: "emerald" },
  { href: "/customers", label: "Customers", icon: Users, accent: "zinc" },
  { href: "/catalog", label: "Catalog", icon: Package, accent: "zinc" },
  { href: "/reports", label: "Reports", icon: BarChart2, accent: "zinc" },
  { href: "/settings", label: "Settings", icon: Settings, accent: "zinc" },
];

/**
 * The four thumb-reachable tabs on mobile.
 *
 * ⚠️ RESHUFFLED IN S9, and not for taste. Two of the original four were
 * /beverages and /bakery, which no longer exist — leaving them out without
 * putting anything back would have left a two-tab bottom bar.
 *
 * The replacements are the two screens the owner actually opens daily now:
 * /sales is where every bill is rung (it was in the "More" sheet, which was
 * already wrong once it became the only till), and /customers answers "who owes
 * me money". Catalog, Reports and Settings stay in "More" — they are set-up and
 * review screens, not daily ones.
 */
export const PRIMARY_NAV: NavItem[] = NAV_ITEMS.filter((item) =>
  ["/", "/sales", "/milk", "/customers"].includes(item.href)
);

/** The rest, reached through the mobile "More" sheet. */
export const SECONDARY_NAV: NavItem[] = NAV_ITEMS.filter((item) =>
  ["/catalog", "/reports", "/settings"].includes(item.href)
);

/**
 * Dashboard lives at "/" (see the URL layout note in CLAUDE.md), so it must
 * match exactly — a `startsWith` test would mark it active on every page.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
