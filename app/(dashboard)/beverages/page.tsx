import type { Metadata } from "next";

import { SalesList } from "@/components/sales/SalesList";
import { BEVERAGES_MODULE } from "@/lib/sale-modules";

/**
 * URL: /beverages
 *
 * `(dashboard)` is a parenthesised route group — it contributes the shared nav
 * shell and NOTHING to the URL (see the URL layout note in CLAUDE.md).
 *
 * A thin server shell over the shared sales list. Everything module-specific —
 * endpoint, accent, copy — comes from BEVERAGES_MODULE, so beverages and bakery
 * render the same component rather than two copies that can drift.
 */
export const metadata: Metadata = {
  title: "Beverages",
};

export default function BeveragesPage() {
  return <SalesList module={BEVERAGES_MODULE} />;
}
