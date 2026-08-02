import type { Metadata } from "next";

import { CatalogManager } from "@/components/catalog/CatalogManager";

/**
 * URL: /catalog
 *
 * `(dashboard)` is a parenthesised route group — it contributes the shared
 * nav shell and NOTHING to the URL (see the URL layout note in CLAUDE.md).
 * There is no literal /dashboard segment, and no app/catalog/ directory: that
 * would resolve to the same /catalog path and collide with this route.
 *
 * The page itself is a thin server shell. All catalog data is fetched
 * client-side through TanStack Query so the inline price editor and the
 * add/edit/delete dialogs can mutate and revalidate without a full navigation.
 */
export const metadata: Metadata = {
  title: "Catalog",
};

export default function CatalogPage() {
  return <CatalogManager />;
}
