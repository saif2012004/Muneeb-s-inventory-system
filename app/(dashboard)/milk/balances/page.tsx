import type { Metadata } from "next";

import { FarmerBalanceSheet } from "@/components/milk/FarmerBalanceSheet";

/**
 * URL: /milk/balances
 *
 * The all-farmers balance sheet — what the owner owes each farmer, biggest
 * payable first. A thin server shell; the balances come from the same
 * `/api/milk/farmers` endpoint the hub uses, so the two can never disagree.
 */
export const metadata: Metadata = {
  title: "Balance sheet",
};

export default function BalancesPage() {
  return <FarmerBalanceSheet />;
}
