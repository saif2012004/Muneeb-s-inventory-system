/**
 * Sending ESC/POS bytes straight to the printer over USB, from the browser.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS BUYS, AND WHAT IT COSTS
 * ---------------------------------------------------------------------------
 * It is the ONLY route from the PWA to the printer that needs no third-party
 * app. The Wi-Fi route cannot be app-free: the printer accepts only raw TCP on
 * port 9100, and no browser can open a TCP socket.
 *
 * The cost is a cable. WebUSB is USB only — it cannot reach the printer over
 * Wi-Fi, so this path means physically connecting the phone to the printer with
 * an OTG adapter.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT WORKS
 * ---------------------------------------------------------------------------
 *   Chrome on Android  ✅  including in the installed PWA. Android's USB host
 *                          stack lets the browser claim the device after a
 *                          permission prompt, which then persists per origin.
 *                          Needs a phone with USB OTG / host mode.
 *
 *   Chrome on Windows  ❌  Windows binds the printer to `usbprint.sys` — which
 *                          is what makes the installed POS-80-Series queue work
 *                          — and WebUSB can only open devices bound to WinUSB.
 *                          Swapping the driver would break the working Windows
 *                          printer for no gain, since the laptop already prints.
 *                          The call fails with a clear message rather than
 *                          hiding the button, so the reason is visible.
 *
 * Requires a secure context. Vercel serves HTTPS, so production is fine; plain
 * `http://` on the LAN is not (localhost is exempt).
 */

/** USB printer class. Not on WebUSB's protected-interface blocklist. */
const PRINTER_INTERFACE_CLASS = 0x07;

/**
 * Bulk transfers are chunked. A receipt is ~1-2 KB and would go in one write,
 * but a long bill on a small-buffered printer can overrun; chunking costs
 * nothing and removes the failure mode.
 */
const CHUNK_BYTES = 4096;

// ---------------------------------------------------------------------------
// Minimal WebUSB types.
//
// `@types/w3c-web-usb` is NOT a dependency and this is the only file that needs
// the API, so the surface actually used is declared here rather than adding a
// package. Deliberately incomplete — extend it if this file grows.
// ---------------------------------------------------------------------------

type UsbDirection = "in" | "out";

interface UsbEndpoint {
  endpointNumber: number;
  direction: UsbDirection;
  type: string;
}

interface UsbAlternateInterface {
  alternateSetting: number;
  interfaceClass: number;
  endpoints: UsbEndpoint[];
}

interface UsbInterface {
  interfaceNumber: number;
  alternate: UsbAlternateInterface;
  alternates: UsbAlternateInterface[];
}

interface UsbConfiguration {
  configurationValue: number;
  interfaces: UsbInterface[];
}

interface UsbDevice {
  productName?: string;
  manufacturerName?: string;
  configuration: UsbConfiguration | null;
  configurations: UsbConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  /**
   * Declared as `Uint8Array` rather than the spec's `BufferSource`: since
   * TypeScript 5.7 typed arrays carry their buffer type, and a plain
   * `Uint8Array` (backed by `ArrayBufferLike`) is not assignable to
   * `ArrayBufferView<ArrayBuffer>`. This is the only thing we ever send.
   */
  transferOut(
    endpointNumber: number,
    data: Uint8Array
  ): Promise<{ bytesWritten: number; status: string }>;
}

interface UsbFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
}

interface Usb {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(options: { filters: UsbFilter[] }): Promise<UsbDevice>;
}

function getUsb(): Usb | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { usb?: Usb }).usb ?? null;
}

/**
 * Whether this browser exposes WebUSB at all.
 *
 * Only tells you the API exists — not that a printer is attached, nor that the
 * platform will let it be claimed (Windows will not). Use it to decide whether
 * offering the button makes sense, not to promise it will work.
 */
export function isUsbPrintSupported(): boolean {
  return getUsb() !== null;
}

/** The printer-class interface of a device, or null if it has none. */
function findPrinterInterface(device: UsbDevice): UsbInterface | null {
  const config = device.configuration ?? device.configurations[0] ?? null;
  if (!config) return null;
  return (
    config.interfaces.find((candidate) =>
      candidate.alternates.some(
        (alt) => alt.interfaceClass === PRINTER_INTERFACE_CLASS
      )
    ) ?? null
  );
}

/** The bulk OUT endpoint — the one that carries print data to the printer. */
function findBulkOutEndpoint(iface: UsbInterface): UsbEndpoint | null {
  const alternates = [iface.alternate, ...iface.alternates];
  for (const alt of alternates) {
    const endpoint = alt.endpoints.find(
      (candidate) => candidate.direction === "out" && candidate.type === "bulk"
    );
    if (endpoint) return endpoint;
  }
  return null;
}

/**
 * An already-permitted printer, if the owner has granted one before.
 *
 * WebUSB permission persists per origin, so after the first time this returns
 * the printer and no picker is shown. Returns null on the first ever print.
 */
async function findGrantedPrinter(usb: Usb): Promise<UsbDevice | null> {
  const devices = await usb.getDevices();
  return devices.find((device) => findPrinterInterface(device) !== null) ?? null;
}

/**
 * Send bytes to the printer over USB.
 *
 * ⚠️ MUST BE CALLED FROM A USER GESTURE (a click handler). `requestDevice`
 * shows a chooser and the browser refuses it outside one — and on the very
 * first print there is no granted device, so the chooser is always needed then.
 *
 * Errors are thrown with messages written for the shop owner, not the console:
 * he is standing at the counter with a customer waiting, and "NetworkError"
 * tells him nothing about the cable that fell out.
 */
export async function printViaUsb(data: Uint8Array): Promise<void> {
  const usb = getUsb();
  if (!usb) {
    throw new Error(
      "This browser can't print over USB. Use Chrome on Android with an OTG cable."
    );
  }

  let device: UsbDevice;
  try {
    // Reuse a previously granted printer so the owner is not re-picking the
    // device on every sale.
    device = (await findGrantedPrinter(usb)) ?? (await usb.requestDevice({
      filters: [{ classCode: PRINTER_INTERFACE_CLASS }],
    }));
  } catch {
    // The chooser throws when it is dismissed, and also when it lists nothing.
    throw new Error(
      "No printer chosen. Check the OTG cable is connected and the printer is on."
    );
  }

  const iface = findPrinterInterface(device);
  if (!iface) {
    throw new Error(
      "That device isn't a printer. Reconnect the cable and pick the printer."
    );
  }

  let claimed = false;
  try {
    await device.open();

    // A device with no active configuration must be given one before its
    // interfaces can be claimed.
    if (!device.configuration) {
      const first = device.configurations[0];
      if (first) await device.selectConfiguration(first.configurationValue);
    }

    const endpoint = findBulkOutEndpoint(iface);
    if (!endpoint) {
      throw new Error(
        "The printer didn't offer a data channel. Unplug it, plug it back in and try again."
      );
    }

    await device.claimInterface(iface.interfaceNumber);
    claimed = true;

    for (let offset = 0; offset < data.length; offset += CHUNK_BYTES) {
      const chunk = data.subarray(offset, offset + CHUNK_BYTES);
      const result = await device.transferOut(endpoint.endpointNumber, chunk);
      if (result.status !== "ok") {
        throw new Error(
          `The printer rejected the data (${result.status}). Check it has paper and the cover is shut.`
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("printer")) throw error;

    /**
     * The Windows case lands here: `usbprint.sys` owns the device, so claiming
     * it fails. Naming the cause is the difference between a fixable situation
     * and a mystery — see the header.
     */
    throw new Error(
      "Couldn't take control of the printer. On a laptop the Windows driver holds it — use the normal Print button there. On the phone, unplug and replug the cable."
    );
  } finally {
    // Always hand the device back, or the next print finds it busy.
    try {
      if (claimed) await device.releaseInterface(iface.interfaceNumber);
      await device.close();
    } catch {
      // Releasing a device that is already gone is not a failure worth
      // surfacing — the print either happened or already threw above.
    }
  }
}
