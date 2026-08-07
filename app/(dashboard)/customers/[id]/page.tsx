import type { Metadata } from "next";

import { CustomerProfile } from "@/components/customers/CustomerProfile";

/**
 * URL: /customers/[id]
 *
 * One customer's ledger: purchases, payments, and the running balance.
 * The title stays generic because the customer's name isn't known until the
 * client query resolves, and fetching it twice just to title the tab would
 * cost a round trip for nothing.
 */
export const metadata: Metadata = {
  title: "Customer",
};

export default function CustomerProfilePage({
  params,
}: {
  params: { id: string };
}) {
  return <CustomerProfile customerId={params.id} />;
}
