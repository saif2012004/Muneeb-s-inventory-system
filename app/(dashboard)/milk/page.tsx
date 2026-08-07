import type { Metadata } from "next";

import { MilkHub } from "@/components/milk/MilkHub";

/**
 * URL: /milk
 *
 * The milk hub — farmers and what the owner owes each of them. A thin server
 * shell; the balances are fetched client-side so recording a delivery can
 * revalidate the list without a navigation.
 */
export const metadata: Metadata = {
  title: "Milk Shop",
};

export default function MilkPage() {
  return <MilkHub />;
}
