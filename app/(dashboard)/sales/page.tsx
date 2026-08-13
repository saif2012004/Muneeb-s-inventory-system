import type { Metadata } from "next";

import { UnifiedSalesList } from "@/components/sales/UnifiedSalesList";

/**
 * URL: /sales — every bill, across all three shops.
 *
 * The per-module lists (`/beverages`, `/bakery`, `/milk/sales`) are unchanged
 * and still live: they read the OLD tables, this reads `Sale`/`SaleItem`. Both
 * coexist by design until S9 removes the old paths.
 */
export const metadata: Metadata = {
  title: "Sales",
};

export default function SalesPage() {
  return <UnifiedSalesList />;
}
