import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EditUnifiedSale } from "@/components/sales/EditUnifiedSale";
import { auth } from "@/lib/auth";
import { LOGIN_ROUTE } from "@/lib/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit sale",
};

/**
 * URL: /sales/[id]/edit — correct a bill already rung up (CHECKLIST #8).
 *
 * A page rather than a dialog: an edit is the same work as ringing the sale up
 * — customer, date, several lines, a running total — and that does not fit in a
 * modal on a phone. It also means the URL is shareable and the back button does
 * the obvious thing.
 *
 * The sale itself is fetched CLIENT-side by the wrapper, so the form gets the
 * same TanStack cache entry the list already populated and an edit invalidates
 * it in one place.
 */
export default async function EditSalePage({
  params,
}: {
  params: { id: string };
}) {
  // Middleware is the gate; this is the backstop if the matcher is narrowed.
  const session = await auth();
  if (!session?.user) redirect(LOGIN_ROUTE);
  if (!params.id) notFound();

  return <EditUnifiedSale saleId={params.id} />;
}
