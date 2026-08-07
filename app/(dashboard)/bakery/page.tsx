import type { Metadata } from "next";

import { SalesList } from "@/components/sales/SalesList";
import { BAKERY_MODULE } from "@/lib/sale-modules";

/**
 * URL: /bakery
 *
 * Same component as /beverages, different module config. If this file ever
 * grows its own copy of the list, that is the signal something genuinely
 * diverged — parameterise it instead.
 */
export const metadata: Metadata = {
  title: "Bakery",
};

export default function BakeryPage() {
  return <SalesList module={BAKERY_MODULE} />;
}
