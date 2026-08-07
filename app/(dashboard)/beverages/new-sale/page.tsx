import type { Metadata } from "next";

import { NewSaleForm } from "@/components/sales/NewSaleForm";
import { BEVERAGES_MODULE } from "@/lib/sale-modules";

/**
 * URL: /beverages/new-sale
 *
 * The owner's most-used screen. A thin server shell — the form needs the
 * customer list and the catalog client-side, and every keystroke updates the
 * running total, so all of it lives in the client component.
 */
export const metadata: Metadata = {
  title: "New beverage sale",
};

export default function NewBeverageSalePage() {
  return <NewSaleForm module={BEVERAGES_MODULE} />;
}
