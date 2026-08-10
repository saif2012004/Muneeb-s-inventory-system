import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PrintControls } from "@/components/receipt/PrintControls";
import { ReceiptDocument } from "@/components/receipt/ReceiptDocument";
import { auth } from "@/lib/auth";
import { isReceiptModuleKey, loadReceipt } from "@/lib/receipt";
import { LOGIN_ROUTE } from "@/lib/routes";

// Prisma cannot run on Edge (Gotcha 3), and a receipt must never be a cached
// copy of an older version of the sale.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Receipt",
};

/**
 * URL: /receipt/{beverages|bakery}/{saleId}
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY OUTSIDE THE (dashboard) ROUTE GROUP
 * ---------------------------------------------------------------------------
 * `(dashboard)/layout.tsx` supplies the sidebar and the mobile bottom nav. This
 * page inherits only the root layout, so the app chrome is not merely HIDDEN at
 * print time — it is never rendered. "Print only the receipt" is then a
 * structural fact rather than a CSS rule that a future layout change could
 * quietly break.
 *
 * Still authenticated: middleware protects everything except /login and
 * /api/auth, and the page checks the session itself as the backstop.
 */
export default async function ReceiptPage({
  params,
}: {
  params: { module: string; id: string };
}) {
  // Same backstop the dashboard layout applies: middleware is the gate, this is
  // the guard if the matcher is ever narrowed. v5 uses auth(), not
  // getServerSession().
  const session = await auth();
  if (!session?.user) redirect(LOGIN_ROUTE);

  if (!isReceiptModuleKey(params.module)) notFound();

  const receipt = await loadReceipt(params.module, params.id);
  if (!receipt) notFound();

  return (
    <main className="receipt-page">
      <PrintControls backHref={`/${receipt.moduleKey}`} />
      <ReceiptDocument receipt={receipt} />
    </main>
  );
}
