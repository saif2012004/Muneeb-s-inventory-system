import type { Metadata } from "next";

import { SettingsForm } from "@/components/settings/SettingsForm";

/**
 * URL: /settings
 *
 * `(dashboard)` is a parenthesised route group — it contributes the shared nav
 * shell and NOTHING to the URL (see the URL layout note in CLAUDE.md).
 *
 * A thin server shell: the form fetches through TanStack Query so saving can
 * update in place without a navigation, and so the unconfigured banner reflects
 * the save immediately.
 */
export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return <SettingsForm />;
}
