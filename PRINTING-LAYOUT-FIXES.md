# Receipt prints, but small / left-aligned / no cut

**Written 2026-08-22.** Wi-Fi printing now works end to end via RawBT's print service. Three
cosmetic faults remain. They are not three problems — they are one, plus a setting.

Companion to `PRINTING-NEXT-STEPS.md` (the to-do list) and `PRINTING-FROM-PHONE.md` (the
investigation record).

---

## The one cause

**RawBT's print service does not send text to the printer. It renders the web page to a PICTURE and
sends that.**

So the receipt is no longer a 48- or 32-character grid being typed by the printer's firmware — it is
a photograph of a web page, scaled to fit whatever paper size the Android print dialog thinks it is
printing on. That single fact explains two of the three faults:

| Symptom | Why |
|---|---|
| **Text too small** | The page is being rendered at a page size much wider than the roll, then shrunk to 576 dots. Everything on it shrinks with it |
| **Left-aligned, not centred** | Same scaling. The receipt occupies the left portion of an over-wide page, and that whole page is what gets scaled onto the roll |
| **No auto-cut** | Unrelated — a picture carries no cut command. Cutting is a RawBT setting |

---

## Fix 1 — paper size (fixes the size AND the alignment)

**In the Android print dialog**, expand the options and look at **Paper size**. This is the control
that matters, and it is in the print sheet itself, not inside the RawBT app.

RawBT offers several sizes, and the naming is the tell:

- Sizes named **with millimetres** — `80mm`, `58mm` — give **large** text
- Sizes named in **inches only** — 2" / 3" / 4" — give **small** text

> Per RawBT's own documentation: *"The largest letters are obtained when choosing a width of 58mm,
> while the smallest are for paper sizes without millimetres in the title."*
> (Read from search results — `rawbt.ru` does not resolve from this network, so the exact menu
> wording on your build may differ from the labels above.)

**Try `80mm` first** — that matches this printer's 576-dot / 72mm head. If it is still too small,
try `58mm`, which produces the largest text of all; the receipt will simply be wider relative to the
roll.

✅ **Checkpoint:** the money column reaches the right-hand edge of the paper instead of stopping
a third of the way across. When it does, the "left-aligned" symptom disappears too — it was never
alignment, it was scale.

## Fix 2 — auto-cut

In the **RawBT app**, open the printer's settings and enable cutting — commonly labelled
*Cut paper*, *Auto cut*, or *Feed and cut after print*. Some builds keep it under the print-service
options rather than the printer profile.

Your SP-90A has a real cutter (`GS V` works — the test slips I sent from the laptop cut themselves),
so this is a setting, not a hardware limit.

---

## ⚠️ Why you will keep fighting this path

Every one of these is you negotiating with Android's print pipeline over a picture. Even once it
looks right, the layout depends on a paper-size dropdown and a scale factor that live outside this
repo — **nothing in the app controls them, and nothing warns you if they change.** A phone update or
a reinstall can silently undo it.

The 32-column browser layout was itself a workaround for this: at 48 columns the rasterised web font
was too small to read, so the app was dropped to 32. That compromise exists *because* of rasterising.

---

## The real fix: send bytes instead of a picture

The `.prn` route solves all three faults at the source, because the printer does the work instead of
being handed a photograph:

| Fault | How the byte path fixes it |
|---|---|
| Text too small | The printer's **own Font A**, 12×24 dots — nothing is scaled, so nothing shrinks |
| Not centred | The shop name is centred by the printer's **`ESC a 1`**; money rows sit on a real 48-column grid |
| No cut | **`GS V 66 0`** — an actual cut command, already in the bytes |

**This is not speculative — it already printed.** On 2026-08-22 I sent a full fixture receipt
(1,023 bytes) to `192.168.10.60:9100` from this laptop and it came out with a centred double-size
`MATEEN TRADERS`, the money column landing at column 48, and the paper cut itself.

It also recovers what the 32-column compromise cost: at 48 columns the **phone number and address fit
on one line each** instead of wrapping.

**What is left to build:**

1. `GET /api/receipt/sale/[id]/escpos` returning the bytes as `receipt.prn`
2. A **short-lived signed token** in the URL — ⚠️ RawBT fetches it **without the login cookie**, so a
   gated route would hand it the login page instead of the receipt
3. A *Print over Wi-Fi* button on the receipt screen

`lib/escpos.ts` and `lib/receipt-lines.ts` already exist from the USB work and produce exactly these
bytes, verified on paper — 27 lines, none over 48 columns, no character lost to `?`. **This is a
route and a button, not a new subsystem.**

---

## Recommendation

**Try Fix 1 and Fix 2 first — five minutes, no code.** If the paper-size dropdown gets the text
readable and the cutter switched on, the current setup is genuinely finished and you can stop here.

**If it stays small, or looks right today and drifts later, build the `.prn` route.** It is the only
version of this where the app decides what the receipt looks like rather than a phone setting.

Tell me which way it goes.

---

## Reference

| | |
|---|---|
| Printer IP / port | `192.168.10.60` : `9100` |
| Print head | 72mm — **576 dots**, Font A 12×24 dots |
| RawBT paper width | **576 dots / 80mm**. 384 is 58mm and wraps every line |
| Browser print path | **32 columns** — `RECEIPT_LINE_CHARS` |
| Native ESC/POS path | **48 columns** — `ESCPOS_LINE_CHARS` |

🔴 **One client at a time on port 9100.** Don't run laptop test prints while testing on the phone.
