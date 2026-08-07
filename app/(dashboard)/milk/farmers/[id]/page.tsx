import type { Metadata } from "next";

import { FarmerProfile } from "@/components/milk/FarmerProfile";

/**
 * URL: /milk/farmers/[id]
 *
 * One farmer's deliveries, purchases and running balance. The whole screen is
 * fed by a single request so it can't render half-loaded.
 */
export const metadata: Metadata = {
  title: "Farmer",
};

export default function FarmerPage({ params }: { params: { id: string } }) {
  return <FarmerProfile farmerId={params.id} />;
}
