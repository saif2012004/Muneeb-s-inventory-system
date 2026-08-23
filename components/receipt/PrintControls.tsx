"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Printer, Usb } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buildEscPosReceipt } from "@/lib/escpos";
import { isUsbPrintSupported, printViaUsb } from "@/lib/usb-print";
import type { ReceiptData } from "@/lib/receipt";

/**
 * The only interactive part of the print page — and the only part `@media print`
 * hides.
 *
 * DELIBERATELY NOT AUTO-PRINTING on mount. An automatic `window.print()` fires
 * before the owner has seen what he is about to print, and on a thermal printer
 * a mistaken print is wasted paper he has to tear off and bin. He opens the
 * page, sees the receipt exactly as it will come out, and presses Print.
 *
 * ---------------------------------------------------------------------------
 * TWO PRINT BUTTONS, AND THEY ARE NOT ALTERNATIVES TO EACH OTHER
 * ---------------------------------------------------------------------------
 *   Print receipt  ->  window.print(). Goes through the OS/driver. On a laptop
 *                      this is the one that works. On Android it needs a
 *                      print-service app, because the SP-90A speaks only raw
 *                      ESC/POS and has no IPP (port 631 closed).
 *
 *   Print over USB ->  native ESC/POS straight down a cable. The only route
 *                      from the phone that needs NO third-party app — at the
 *                      cost of physically connecting the phone to the printer.
 *
 * They also print at different widths on purpose: 32 columns rasterised by the
 * browser, 48 columns in the printer's own font. See `lib/receipt-lines.ts`.
 */
export function PrintControls({
  backHref,
  receipt,
}: {
  backHref: string;
  receipt: ReceiptData;
}) {
  const router = useRouter();
  const [usbAvailable, setUsbAvailable] = useState(false);
  const [printing, setPrinting] = useState(false);

  /**
   * `navigator.usb` cannot be read during a server render, so the button is
   * mounted only after hydration. Checking it inline would either mismatch the
   * server HTML or hide the button on every first paint.
   */
  useEffect(() => {
    setUsbAvailable(isUsbPrintSupported());
  }, []);

  async function handleUsbPrint() {
    // Bytes are built BEFORE the device chooser opens. A failure here is a bug
    // in our own layout, and finding it after the owner has picked a printer
    // wastes his time and possibly a sheet of paper.
    let data: Uint8Array;
    try {
      data = buildEscPosReceipt(receipt);
    } catch (error) {
      console.error("Failed to build ESC/POS receipt", error);
      toast.error("Couldn't prepare the receipt. Use the normal Print button.");
      return;
    }

    setPrinting(true);
    try {
      await printViaUsb(data);
      toast.success("Sent to the printer.");
    } catch (error) {
      // `printViaUsb` throws messages written for the owner, so they are shown
      // as-is; the real error goes to the console for us.
      console.error("USB print failed", error);
      toast.error(
        error instanceof Error ? error.message : "Couldn't print over USB."
      );
    } finally {
      setPrinting(false);
    }
  }

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

      {usbAvailable ? (
        <Button
          variant="outline"
          className="h-11 rounded-lg"
          onClick={handleUsbPrint}
          disabled={printing}
        >
          {printing ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          ) : (
            <Usb className="mr-2 size-4" aria-hidden />
          )}
          {printing ? "Printing…" : "Print over USB"}
        </Button>
      ) : null}

      <Button className="h-11 rounded-lg" onClick={() => window.print()}>
        <Printer className="mr-2 size-4" aria-hidden />
        Print receipt
      </Button>
    </div>
  );
}
