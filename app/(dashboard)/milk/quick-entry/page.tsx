import type { Metadata } from "next";

import { QuickEntryGrid } from "@/components/milk/QuickEntryGrid";

/**
 * URL: /milk/quick-entry
 *
 * The twice-daily round: one date, every farmer, one save.
 */
export const metadata: Metadata = {
  title: "Quick entry",
};

export default function QuickEntryPage() {
  return <QuickEntryGrid />;
}
