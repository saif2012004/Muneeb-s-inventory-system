import {
  BarChart2,
  GlassWater,
  LayoutDashboard,
  Milk,
  Package,
  ShoppingBag,
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

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  accent: AccentKey;
};

/** Full navigation, in sidebar order. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, accent: "zinc" },
  { href: "/beverages", label: "Beverages", icon: GlassWater, accent: "blue" },
  { href: "/bakery", label: "Bakery", icon: ShoppingBag, accent: "amber" },
  { href: "/milk", label: "Milk Shop", icon: Milk, accent: "emerald" },
  { href: "/customers", label: "Customers", icon: Users, accent: "zinc" },
  { href: "/catalog", label: "Catalog", icon: Package, accent: "zinc" },
  { href: "/reports", label: "Reports", icon: BarChart2, accent: "zinc" },
];

/** The four thumb-reachable tabs on mobile. */
export const PRIMARY_NAV: NavItem[] = NAV_ITEMS.filter((item) =>
  ["/", "/beverages", "/bakery", "/milk"].includes(item.href)
);

/** The rest, reached through the mobile "More" sheet. */
export const SECONDARY_NAV: NavItem[] = NAV_ITEMS.filter((item) =>
  ["/customers", "/catalog", "/reports"].includes(item.href)
);

/**
 * Dashboard lives at "/" (see the URL layout note in CLAUDE.md), so it must
 * match exactly — a `startsWith` test would mark it active on every page.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
