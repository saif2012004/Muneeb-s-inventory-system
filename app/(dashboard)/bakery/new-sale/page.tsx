import type { Metadata } from "next";

import { NewSaleForm } from "@/components/sales/NewSaleForm";
import { BAKERY_MODULE } from "@/lib/sale-modules";

/**
 * URL: /bakery/new-sale
 *
 * Same form as beverages. The bakery-specific behaviour — attribute-less
 * products rendering as a single named choice, eggs counted in cottons, all
 * four Russ variants distinguishable — comes from the product data itself via
 * lib/sale-catalog.ts, not from a separate component.
 */
export const metadata: Metadata = {
  title: "New bakery sale",
};

export default function NewBakerySalePage() {
  return <NewSaleForm module={BAKERY_MODULE} />;
}
