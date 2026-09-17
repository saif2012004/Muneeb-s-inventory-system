# Printing receipts from the phone — Speed-X SP-90A

**Status as of 2026-08-22: the blocker is FIXED; the remaining steps are configuration.**
RawBT now keeps its printer across an app restart, which was the actual fault. **A bridge app is
structurally required for the Wi-Fi path** — that is a browser limitation, not a coding gap. Only
the USB path can be app-free.

> 👉 **For what to do next, see `PRINTING-NEXT-STEPS.md`.** This file is the investigation record:
> what was proven, what was ruled out *and why*. That one is the current to-do list.

This file is the working record: what has been proven, what has been ruled out *and why*, and the
open decisions.

---

## The hardware facts (established, not assumed)

Read from the CD-ROM guides in `F:\Downloads\printer\Printer CD-ROM` and from the live device.

| | Value |
|---|---|
| Printer IP | **192.168.10.60** (static, set by `WIFI OneKey Setting.exe`) |
| Print data port | **9100**, raw TCP |
| Printer MAC | **74:E9:D8:98:D3:F6** |
| Router | 192.168.10.1 · this laptop is 192.168.10.42 on the same Wi-Fi |
| Windows driver | installed on port **USB001** — it does *not* touch 9100 |

### Port scan of the printer (2026-08-22)

```
   80  OPEN     WiFi module config page - HTTPD, Basic auth "USER LOGIN". NOT a print endpoint
  443  closed
  515  closed   no LPD
  631  closed   no IPP  <- this is the one that matters
 4000  closed
 8080  closed
 9100  OPEN     raw ESC/POS. The only way in.
```

**If 631 had been open, Android would print natively via Mopria and none of this would be
needed.** It is not. Grepping all nine manuals confirms it: no AirPrint, no Mopria, no IPP
anywhere. **This is why Android's print dialog will never list the SP-90A on its own.**

### 🔴 One client at a time on port 9100

Confirmed by accident: a laptop print was refused with `ECONNRESET` at exactly the moment RawBT
held the socket, and succeeded once RawBT was closed. **While one app holds it, nothing else can
print.** Test one side at a time, or you will debug the wrong thing.

### The bundled Android app is a dead end

`Android App/Thermal Printer.apk` — manifest declares one `MAIN`/`LAUNCHER` activity, no
`PrintService`, no `SEND`/`VIEW` intent filter. A self-contained test tool; it **cannot print a web
page**. Its only UUID is `00001101` (Bluetooth Classic SPP), which also kills Web Bluetooth from
the PWA — Web Bluetooth is BLE-GATT only and cannot speak SPP.

---

## 🔴 Why the PWA cannot print directly — three independent blocks

Asked and verified 2026-08-22. Any one of these alone is fatal.

1. **The printer speaks only raw TCP on 9100.** No IPP, no LPD, no HTTP print endpoint
   (port 80 is a password-protected Wi-Fi config page).
2. **Browsers have no raw TCP API.** Not `fetch`, not WebSocket — the printer does no WebSocket
   handshake, it just wants bytes on a socket. No JavaScript on any platform can open one.
3. **Mixed content.** The PWA is served over **HTTPS** from Vercel. Chrome blocks any request from
   an HTTPS page to a plain-`http` LAN address outright. Even a hypothetical HTTP print endpoint
   would be unreachable.

And server-side is out for a separate reason: the Vercel function runs in Mumbai, while
`192.168.10.60` is a private address behind the shop's router. Nothing outside the shop routes to it.

**Conclusion: the bridge app is the Android equivalent of the printer driver already installed on
Windows.** There is no version of this where the browser talks to the printer over Wi-Fi.

---

## What works and what doesn't

| Link in the chain | Status |
|---|---|
| Printer prints over Wi-Fi, raw ESC/POS to `192.168.10.60:9100` | ✅ verified — laptop → slip, twice |
| RawBT → printer | ✅ verified — RawBT's own in-app test print works |
| Chrome link → opens RawBT | ✅ verified |
| **RawBT printing our payload** | ❌ **the break** — RawBT opens, its Print button does nothing |

### ✅ The cause — CONFIRMED AND FIXED 2026-08-22

> "when i close rawbt, it removes the connection and i have to add the printer again each time"

**That was the fault, not a side annoyance.** RawBT was losing its saved printer, so when Chrome
opened it through a link it started with **no printer attached** and Print failed silently. The
in-app test worked only because the printer had been added by hand moments before; switching to
Chrome and back is exactly what dropped it.

**Fixed by the battery/autostart settings below.** The connection now survives closing and
restarting the app, and RawBT's own test prints reliably. What remains is registering RawBT as an
Android **print service** — see `PRINTING-NEXT-STEPS.md`.

**Fix (applies to any bridge app — a budget Android will do this to all of them):**
- Settings → Apps → *app* → Battery → **Unrestricted**
- **Autostart / auto-launch → allow.** Separate toggle on Xiaomi, Oppo, Vivo, Realme, Infinix
- Save the printer as **default**, not just "Connect"

**Verify:** close the app fully, reopen, confirm the printer is still listed *without* re-adding.
Do not test printing until that holds.

### 🔴 The RawBT licence does NOT gate the API

It only **removes an advertising line from the printout**. Speed, quality and behaviour are
identical either way. So the licence nag is *not* why the Print button did nothing.

But it does rule out free RawBT for real use: **an advert line on every customer's bill is not
acceptable on a receipt the owner hands over.** With RawBT it is "buy the licence" or nothing.

---

## Options, ranked

| | Approach | Cost | Code changes |
|---|---|---|---|
| **1** | **NokoPrint** as an Android print service | free | **none** |
| 2 | Other print services — ESC POS Print Service, CoralFSG | free | none |
| 3 | RawBT, licensed | small one-off | none if its print service works; `.prn` route if not |
| 4 | `.prn` file route + any bridge app | — | small route + signed token |
| 5 | WebUSB from the PWA | free, **no app** | 200–300 lines, **cable required** |

**Option 1 is untried and is the ten-minute test that could end this with zero code.** NokoPrint
registers as a proper Android print service; if it appears in Chrome's print dialog, the existing
Print button works unchanged, with the current 32-column layout the owner can already read.
Install → add printer → **Network/Wi-Fi**, `192.168.10.60:9100`, driver **generic ESC/POS** →
Settings → Printing → enable the service.

---

## WebUSB — verdict

**Laptop Chrome: effectively no.** Windows binds the printer to **`usbprint.sys`** (that is what
makes the `POS-80-Series` queue on `USB001` work). Chrome's WebUSB on Windows can only open devices
bound to **WinUSB**. Swapping the driver with Zadig would **break the working Windows printer**, and
buys nothing — the laptop already prints.

**Phone Chrome: yes, genuinely.** WebUSB is supported in Chrome for Android including inside an
installed PWA; Android's USB host stack lets Chrome claim the device after a permission prompt that
then persists per origin. HTTPS is required and Vercel provides it. Needs a phone with **USB OTG /
host mode** and an OTG adapter.

**The catch that decides it: WebUSB is USB only.** It cannot reach the printer over Wi-Fi. Choosing
it means discarding the Wi-Fi setup and **physically plugging the phone into the printer for every
receipt**. That is a worse counter workflow than installing one free app once — but it is the only
remaining route that needs no third-party app at all.

---

## The plan, if both Wi-Fi and USB are wanted

| Path | Third-party app | Cable |
|---|---|---|
| **USB** | **none** — PWA talks to the printer directly | required |
| **Wi-Fi** | **still required** (NokoPrint / RawBT) | none |

**Good news from reading the code:** every helper in `lib/receipt-format.ts` already takes an
optional `width` parameter defaulting to `RECEIPT_LINE_CHARS`. **The 48-column ESC/POS layout is a
parameter, not a rewrite.**

1. **Shared core — `lib/escpos.ts`.** Needed by both paths, so it cannot be wasted work. Thread a
   `width` argument through `buildReceiptLines` (32 stays the browser default, 48 for ESC/POS), then
   wrap the lines in ESC/POS: init, shop name, 48-column body in normal Font A, double-size TOTAL,
   feed, cut.
2. **USB transport.** `navigator.usb.requestDevice`, claim the printer interface, find the bulk OUT
   endpoint, `transferOut`. One permission grant, then it persists.
3. **Wi-Fi transport.** `GET /api/receipt/sale/[id]/escpos` returning the same bytes as
   `receipt.prn`. ⚠️ Needs a **short-lived signed token in the URL** — the bridge app fetches it
   *without* the login cookie, so a middleware-gated route would hand it the login page.
4. **`CLAUDE.md`.** The four-edit receipt table gains a row: browser path 32, ESC/POS path 48,
   diverging deliberately. That divergence is exactly what the table exists to catch.

### 🔴 The space-padding trap — carried over from `ReceiptDocument.tsx:230`

`buildReceiptLines` deliberately returns **only the text of the roll**, no presentation. The shop
name is rendered separately by the component because `centreLines` centres by **prepending spaces**
to fill the character grid — and those spaces are glyphs. Enlarge the font and the padding enlarges
with it, shoving the name right and off the paper.

**The identical bug exists in ESC/POS.** Space-pad the name to 48 columns, then send `GS ! 0x11`
for double size, and the padding doubles too and the name walks off the 72mm head.

> **Rule for the builder:** anything printed at double size must be centred with the printer's own
> **`ESC a 1`** command on the **trimmed** string — never by padding. Only normal-size rows sit on
> the character grid.

---

## The font decision — settled 2026-08-22

A three-block comparison was printed on the real device (normal / double-height / double-both).
**The owner picked A — the printer's normal Font A at 48 columns.**

| | Character size | Money column |
|---|---|---|
| Browser @ 48 | 1.43 × ~2.4mm | fits, but he could not read it |
| Browser @ 32 (current) | 2.19 × ~3.5mm | fits, at the cost of wrapping phone + address |
| **Native ESC/POS Font A @ 48** | **1.5 × 3.0mm** | **fits, and he can read it** |
| Native double-both @ 24 | 3.0 × 6.0mm | `TOTAL   Rs. 15,740.00` is 21 of 24 — breaks on a bigger total |

**The 32-character compromise was a browser-rendering artifact, not a limit of his eyesight or the
hardware.** The printer's own dot-matrix glyphs are 3.0mm tall against the browser's ~2.4mm at the
same 48 columns, and are crisper than a rasterised web font.

⚠️ **Applies to the ESC/POS path only.** The browser `window.print()` path stays at 32.

---

## Ruled out — do not re-try these

| Approach | Why not |
|---|---|
| Android's built-in print dialog, unaided | No IPP/Mopria/AirPrint — port 631 closed. Nothing to configure |
| Web Bluetooth from the PWA | Printer is Bluetooth **Classic SPP** (`00001101`); Web Bluetooth is BLE-only |
| Raw TCP 9100 from the browser | Browsers cannot open TCP sockets |
| HTTP to the printer from the PWA | Port 80 is a Basic-auth config page, and HTTPS→http is blocked as mixed content |
| Server-side print from Vercel | Function is in Mumbai; printer is behind the shop's NAT |
| The bundled `Thermal Printer.apk` | No `PrintService`, no share intent — test tool only |
| Typing `rawbt:…` into Chrome's address bar | The omnibox searches instead of handing off; only a real link click works |
| Tapping links in a published artifact | Sandboxed iframe blocks custom-scheme navigation |
| WebUSB on the laptop | Printer is claimed by `usbprint.sys`; switching to WinUSB breaks the working driver |
| Free RawBT for production | Prints an advert line on every customer bill |

---

## Open questions — blocking the build

1. **Is a bridge app acceptable for the Wi-Fi path?** It is unavoidable there. Only USB can be
   app-free. If both had to be app-free, only the USB half is buildable.
2. **Does the phone support USB OTG / host mode?** If not, the USB half is dead on arrival and
   should not be written. Quickest test: plug an OTG adapter in with a USB stick or mouse and see
   if the phone reacts.
3. **Has NokoPrint been tried?** Still the cheapest possible outcome — zero code.

---

## Test harness (still available)

A six-test page is served off the laptop over the LAN. Artifact sandboxes and the Chrome address
bar both block custom-scheme handoff — **only a real page works**.

```
! python -m http.server 8000 --bind 0.0.0.0 --directory "C:/Users/SAIF/AppData/Local/Temp/claude/E--Carreer-efforts-Muneeb-s-inventory-system/9d3b176e-76a5-4de8-be08-05bb2dfeba11/scratchpad/serve"
```

Phone: `http://192.168.10.42:8000`

| # | Channel | Proves |
|---|---|---|
| 1 | `rawbt:` plain text | RawBT owns the scheme |
| 2 | `intent:` + package | Same, explicitly — opens Play Store if RawBT isn't installed |
| 3 | `rawbt:base64,` ESC/POS | Binary passthrough, font + cutter commands |
| 4 | `rawbt:base64,` full bill | The whole receipt |
| **5** | **`http://…/test.txt`** | **File channel — plain text** |
| **6** | **`http://…/receipt.prn`** | **File channel — full ESC/POS bill** |

**5 and 6 matter most**: bytes travel as a file download rather than inside a URL, which removes
URL-encoding mangling (`+`, `/`, `=`) and length limits — and it is the only channel that scales to
production, since the file can come from Vercel while the bridge app does the LAN hop.

---

## Operational note for handover

The OneKey tool set a static IP **on the printer**, but the router was never told `.60` is taken.
This laptop was handed `.42` by DHCP, so the pool starts low and very likely covers `.60`.

**Fix at the router (192.168.10.1), one of:**
- DHCP **reservation** binding `74:E9:D8:98:D3:F6` → `192.168.10.60` (preferred — survives a reset)
- or shrink the DHCP pool to end at `.50`

Left undone, the router will eventually lease `.60` to a customer's phone and the printer will
"just stop working" — intermittently, and never while anyone is looking at it.
