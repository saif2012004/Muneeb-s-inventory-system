"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The only interactive part of the print page — and the only part `@media print`
 * hides.
 *
 * DELIBERATELY NOT AUTO-PRINTING on mount. An automatic `window.print()` fires
 * before the owner has seen what he is about to print, and on a thermal printer
 * a mistaken print is wasted paper he has to tear off and bin. He opens the
 * page, sees the receipt exactly as it will come out, and presses Print.
 */
export function PrintControls({ backHref }: { backHref: string }) {
  const router = useRouter();

  return (
    <div className="receipt-controls">
      <Button
        variant="outline"
        className="h-11 rounded-lg"
        onClick={() => router.push(backHref)}
      >
        <ArrowLeft className="mr-2 size-4" aria-hidden />
        Back to sales
      </Button>

      <Button className="h-11 rounded-lg" onClick={() => window.print()}>
        <Printer className="mr-2 size-4" aria-hidden />
        Print receipt
      </Button>
    </div>
  );
}
