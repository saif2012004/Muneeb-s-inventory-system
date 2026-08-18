import type { Metadata } from "next";

import { UnifiedSalesList } from "@/components/sales/UnifiedSalesList";

/**
 * URL: /sales — every bill, across all three shops.
 *
 * THE ONLY SALES SCREEN since S9. `/beverages`, `/bakery` and `/milk/sales`
 * were deleted with the tables they read; the "Shop" filter here is what
 * replaced them, and it matches a bill if ANY of its lines belong to that shop.
 */
export const metadata: Metadata = {
  title: "Sales",
};

export default function SalesPage() {
  return <UnifiedSalesList />;
}
