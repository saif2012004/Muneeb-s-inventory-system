import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PrintControls } from "@/components/receipt/PrintControls";
import { ReceiptDocument } from "@/components/receipt/ReceiptDocument";
import { auth } from "@/lib/auth";
import { loadUnifiedReceipt } from "@/lib/receipt";
import { LOGIN_ROUTE } from "@/lib/routes";

// Prisma cannot run on Edge (Gotcha 3), and a receipt must never be a cached
// copy of an older version of the sale.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Receipt",
};

/**
 * URL: /receipt/sale/{saleId} — the UNIFIED bill's receipt.
 *
 * A sibling of `/receipt/[module]/[id]` rather than a third `module` value,
 * because it reads a different table. `[module]` is matched by literal segments
 * first in Next's routing, so `sale` lands here and `beverages`/`bakery` still
 * land on the per-module page.
 *
 * Outside the `(dashboard)` route group, exactly like the per-module receipt: no
 * sidebar and no bottom nav are RENDERED at all, so "print only the receipt" is
 * structural rather than a CSS rule a future layout change could break.
 */
export default async function UnifiedReceiptPage({
  params,
}: {
  params: { id: string };
}) {
  // Middleware is the gate; this is the backstop if the matcher is ever
  // narrowed. v5 uses auth(), not getServerSession().
  const session = await auth();
  if (!session?.user) redirect(LOGIN_ROUTE);

  const receipt = await loadUnifiedReceipt(params.id);
  if (!receipt) notFound();

  return (
    <main className="receipt-page">
      <PrintControls backHref="/sales" />
      <ReceiptDocument receipt={receipt} />
    </main>
  );
}
