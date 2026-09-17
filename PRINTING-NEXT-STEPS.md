# Wi-Fi printing from the phone — next steps

**Written 2026-08-22.** Companion to `PRINTING-FROM-PHONE.md`, which holds the full investigation
(hardware facts, what was ruled out and why). This file is only *what to do next*.

---

## Where we are

| | Status |
|---|---|
| Printer prints over Wi-Fi, raw ESC/POS to `192.168.10.60:9100` | ✅ proven — laptop → slip, several times |
| RawBT → printer | ✅ proven — RawBT's own test prints |
| **RawBT keeps its printer across an app restart** | ✅ **fixed** — this was the real fault |
| RawBT registered as an Android **print service** | ⬜ **next — Step 1 below** |
| Printing a real receipt from the app | ⬜ Step 2 |

**The thing that was broken is fixed.** RawBT was being killed by Android and starting cold with no
printer attached, which is why the Print button did nothing while its in-app test worked. Everything
below was blocked on that and is now unblocked.

**Decision taken:** free RawBT. It prints an advertising line on each printout, which will appear on
customer receipts. Accepted knowingly; a licence removes only that line and changes nothing else.

---

## Step 1 — enable RawBT as a print service

Android installs third-party print services **disabled**. This is why RawBT never appeared in
Chrome's print dialog, and no amount of configuring RawBT itself would have changed it.

On the phone:

**Settings → search "Print"** → *Printing* / *Print services* → **RawBT → toggle ON**

On most phones the full path is **Settings → Connected devices → Connection preferences → Printing**.

✅ **Checkpoint:** RawBT appears in that list with the toggle **on**.

---

## Step 2 — print a real receipt

1. Open the app on the phone and go to any sale
2. Open its receipt — `/receipt/sale/{id}`
3. Tap **Print receipt**
4. In the print sheet, **tap the printer selector at the top** — it defaults to *Save as PDF*
5. Choose **RawBT** (it may sit behind *All printers…*)
6. Print

⚠️ **Step 4 is the one people miss.** RawBT will not select itself; if you only ever see
"Save as PDF", you have not opened the dropdown.

✅ **Checkpoint:** a receipt comes out with the money column aligned and the arithmetic multiplying
out — e.g. `2 peti × 7,000.00` against `Rs. 14,000.00`.

---

## What to report back

Whichever happens, this is what tells me the next move:

- **It printed** → done. Check the money column lines up and the totals multiply out, then this is
  finished and the `.prn` fallback below is never needed.
- **RawBT is not in the print-service list** → its print service isn't registering. Go to the
  fallback.
- **RawBT is in the list but not in the print dialog** → same conclusion, go to the fallback.
- **It printed but the layout is wrong** → tell me *what* is wrong (column drifts, lines wrap,
  text too small). The browser path prints at **32 columns**; RawBT rasterises that page, so its own
  paper-width setting must not disagree. Check RawBT's width is **576 dots / 80mm**, which is this
  printer's 72mm head — **384 would be 58mm and would wrap every line into nonsense**.

---

## If Step 1 or 2 fails — the `.prn` fallback

If RawBT's print service will not register, the print dialog is a dead end and we stop trying to
make it work. The alternative does not use Android's print framework at all.

**How it works:** RawBT registers itself to open `http` links ending in `.prn`. So the app serves the
receipt as a *file*, RawBT downloads it and sends it to the printer.

```
app on Vercel  →  serves receipt.prn  →  RawBT downloads it  →  prints over Wi-Fi to .60
```

**Why this is the better channel anyway:**

- No URL-encoding mangling — base64 in a URL breaks on `+`, `/` and `=`
- No URL length limit, so a long bill is safe
- **It works from production**, not just on the shop Wi-Fi. The file comes from Vercel; RawBT does
  the last hop over the LAN. Nothing local is needed
- It sends the printer's **native font at 48 columns**, which the owner confirmed he can read —
  sharper and faster than a rasterised page, and it puts the phone number and address back on one
  line each

**What I would need to build:**

1. `GET /api/receipt/sale/[id]/escpos` returning the bytes as `receipt.prn`
2. A **short-lived signed token** in the URL — ⚠️ RawBT fetches the URL **without the login cookie**,
   so a middleware-gated route would hand it the login page instead of the receipt
3. A *Print over Wi-Fi* button on the receipt screen

**Most of this already exists.** `lib/escpos.ts` and `lib/receipt-lines.ts` were written for the USB
path and produce exactly these bytes — verified on paper, 27 lines, none over 48 columns. The
fallback is a route and a button, not a new subsystem.

---

## Reference

| | |
|---|---|
| Printer IP / port | `192.168.10.60` : `9100` |
| Printer MAC | `74:E9:D8:98:D3:F6` |
| RawBT paper width | **576 dots / 80mm** (= this printer's 72mm head). Not 384 |
| Browser print path | **32 columns** — `RECEIPT_LINE_CHARS` |
| Native ESC/POS path | **48 columns** — `ESCPOS_LINE_CHARS` |

🔴 **Only one client at a time on port 9100.** While RawBT holds it, nothing else can print, and
vice versa. Don't run laptop test prints while testing on the phone — the failure looks like a
printer fault and isn't one.

---

## Still outstanding, unrelated to this

**The USB path is built but unproven.** `lib/usb-print.ts` + a *Print over USB* button are written,
type-check clean and the receipt content is verified on paper — but the USB transfer itself has
never run, because Windows binds the printer to `usbprint.sys` and WebUSB cannot claim it. It needs
the phone with an OTG cable, and **whether the phone supports USB OTG is still unconfirmed**.

**None of the code is committed or deployed.** The owner's phone loads the app from Vercel, so the
USB button does not exist for him yet. Wi-Fi printing via the print service (Steps 1–2) needs no
deploy at all — it uses the existing Print button.

**Router: reserve `.60`.** The static IP was set on the printer, but the router was never told. This
laptop was handed `.42` by DHCP, so the pool starts low and likely covers `.60`. Add a DHCP
reservation for `74:E9:D8:98:D3:F6` at `192.168.10.1`, or shrink the pool to end at `.50` — otherwise
the printer will one day "just stop working", intermittently.
