import type { Metadata } from "next";

import { UnifiedSaleForm } from "@/components/sales/UnifiedSaleForm";

/**
 * URL: /sales/new — the unified till.
 *
 * One bill, any product from any shop, milk included by the litre. Posts to
 * `POST /api/sales`, which snapshots each line's module and decrements stock
 * for every line in one transaction.
 */
export const metadata: Metadata = {
  title: "New sale",
};

export default function NewUnifiedSalePage() {
  return <UnifiedSaleForm />;
}
