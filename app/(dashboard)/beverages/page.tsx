import type { Metadata } from "next";

import { SalesList } from "@/components/beverages/SalesList";

/**
 * URL: /beverages
 *
 * `(dashboard)` is a parenthesised route group — it contributes the shared nav
 * shell and NOTHING to the URL (see the URL layout note in CLAUDE.md).
 *
 * A thin server shell. The list is fetched client-side through TanStack Query
 * so filters, pagination and delete can revalidate without a navigation.
 */
export const metadata: Metadata = {
  title: "Beverages",
};

export default function BeveragesPage() {
  return <SalesList />;
}
