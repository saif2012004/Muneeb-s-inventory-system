import type { Metadata } from "next";

import { DashboardHome } from "@/components/dashboard/DashboardHome";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * `/` — the app root.
 *
 * Thin by design: the figures need TanStack Query (cache shared with the
 * "Today" tab on /reports), so the work lives in the client component. See
 * DashboardHome for why this shows today's real revenue rather than the three
 * hardcoded Rs. 0 cards it carried from Phase 1 through Phase 7.
 */
export default function DashboardPage() {
  return <DashboardHome />;
}
