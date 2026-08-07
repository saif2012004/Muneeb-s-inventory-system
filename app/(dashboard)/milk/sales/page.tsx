import type { Metadata } from "next";

import { MilkSalesList } from "@/components/milk/MilkSalesList";

/**
 * URL: /milk/sales
 *
 * Milk sold to hotels, shops and individuals — the money-in side of the milk
 * shop, kept on its own screen so it never blurs with what the owner owes
 * farmers.
 */
export const metadata: Metadata = {
  title: "Milk sales",
};

export default function MilkSalesPage() {
  return <MilkSalesList />;
}
