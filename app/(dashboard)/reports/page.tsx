import type { Metadata } from "next";

import { ReportsDashboard } from "@/components/reports/ReportsDashboard";

/**
 * URL: /reports
 *
 * Cross-module reporting and CSV export. A thin server shell — the figures are
 * fetched client-side so switching period revalidates without a navigation, and
 * Recharts needs the browser anyway (ResponsiveContainer measures its parent,
 * so it does not render during SSR).
 */
export const metadata: Metadata = {
  title: "Reports",
};

export default function ReportsPage() {
  return <ReportsDashboard />;
}
