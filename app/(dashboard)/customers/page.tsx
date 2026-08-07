import type { Metadata } from "next";

import { CustomersHub } from "@/components/customers/CustomersHub";

/**
 * URL: /customers
 *
 * The receivables hub — who owes the owner money, across all three modules.
 * A thin server shell; the balances are fetched client-side so recording a
 * payment can revalidate the list without a navigation.
 */
export const metadata: Metadata = {
  title: "Customers",
};

export default function CustomersPage() {
  return <CustomersHub />;
}
