# Paper width: 58mm, recorded. Caps derived from it. Settings is fully committed.

**Date:** 2026-08-10
**Status:** ✅ Committed, nothing outstanding on settings. ⏸️ Receipt not started — ready for it.

---

## 1. The printer: I have no information, so 58mm

**Searched the entire repo before answering** — every `.md`, `.ts`, `.tsx` and `.json` outside
`node_modules`, for `thermal`, `58mm`, `80mm`, `esc/pos`, `printer`, `receipt`. The only hits are my
own files from the last two turns. **No model, no interface, no paper width has ever been recorded
in this project.**

So: **58mm**, by your default-to-narrower rule, and the asymmetry is worth writing down because it
is the whole argument:

> A 58mm layout also prints on 80mm — it just leaves margin. An 80mm layout **overflows** 58mm and
> wraps every line into nonsense. The cost of guessing narrow is white space; the cost of guessing
> wide is an unreadable receipt.

**Confirm the actual roll before handoff.** It is one question to the owner, and it changes one
constant.

---

## 2. Your two numbers disagreed, and I went with 32

Your message says **58mm ≈ 32 chars/line** and, three lines later, **"set the name cap … (~20 for
58mm)"**. Those cannot both be the one-line budget, so I did not want to silently pick one.

**I used 32**, because it is your own figure and it is what the hardware actually gives:

| Roll | Print head | Font A (12 dots/char) | Font B (9 dots/char) |
|---|---|---|---|
| **58mm** | 384 dots | **32** | 42 |
| 80mm | 576 dots | 48 | 64 |

*(Standard ESC/POS figures — stated as spec, not measured against the owner's printer, which we do
not have.)*

**Why not 20:** a cap below the physical line capacity rejects shop names that would print
perfectly. `Bismillah General Store` is 23 characters and fits a 58mm line with room to spare — at
20 the owner would be told his own shop name is too long, which is the same false rejection we
removed from the phone field last turn, just wearing a different hat.

**Where 20-ish does become real, and where it belongs:** if the receipt prints the header in
**double-width** — common, and it looks right on a receipt — the budget halves to **16**. That is a
*rendering* decision, and the correct handling is for the receipt to drop a long name to normal
width, not for the validator to refuse it. Recorded as a note for the receipt half rather than
baked into validation. If you'd rather the header always be double-width and the cap be 16, say so
and it is a one-line change.

---

## 3. Multiple phone numbers: free text, unchanged

Already how it works, now stated so it cannot be "helpfully" improved later. The cap stays **60**,
and CLAUDE.md and the code both say explicitly:

> **Do not parse, split, or normalise the numbers into separate fields** — that is format
> enforcement wearing a data-model hat.

---

## 4. Final caps, and they are DERIVED, not typed

| Field | Cap | Source |
|---|---|---|
| `shopName` | **32** | `RECEIPT_LINE_CHARS` — one 58mm line |
| `shopPhone` | 60 | ~2 lines; two numbers as free text |
| `shopAddress` | 200 | Wraps to ~6 lines; a paste guard |

`RECEIPT_LINE_CHARS = 32` now lives in **`lib/settings-display.ts`** (dependency-free, so the
receipt renderer can import it too), and **both the server schema and the client form schema read
it** rather than repeating the number. That matters for a reason we already hit once: if the two
schemas disagree, the browser accepts what the API rejects.

**If the printer turns out to be 80mm, change that one constant to 48** and the shop-name cap, the
validation message and the field hint all follow. Nothing to hunt down.

I left `shopAddress` at 200 rather than trimming it — you only pinned the name, and 200 is a paste
guard rather than a layout claim. Worth a glance when the receipt half lands, since ~6 wrapped lines
of address is a lot of header.

---

## 5. Verified in the browser

| # | Case | Result |
|---|---|---|
| 1 | Field hints | ✅ *"Printed at the top of every receipt — up to 32 characters, so it fits one line."* and *"Two numbers are fine — write them however you like."* |
| 2 | **41-character name** (`ZZ_TEST_ A Very Long Shop Name That Wraps`) | ✅ **Rejected**: *"Shop name must be 32 characters or fewer — it has to fit one line on the receipt."* Nothing sent |
| 3 | **Exactly 32** (`ZZ_TEST_ Bismillah General Store`) | ✅ **Saved.** `length = 32`, `configuredAt` stamped — the boundary is inclusive, as intended |

So the cap is confirmed from both sides rather than assumed from one.

Row restored to its seeded state afterwards — `SET SHOP NAME IN SETTINGS` / `SET PHONE IN SETTINGS`
/ `SET ADDRESS IN SETTINGS`, `configuredAt` back to **NULL** — so CHECKLIST #2b still reads
outstanding. `tsc --noEmit` exit 0, `next lint` clean.

*(Two clicks missed their target again mid-run because the content column re-lays out between the
screenshot and the click. Element refs are reliable where coordinates are not — worth remembering
for the receipt verification.)*

---

## 6. Recorded in CLAUDE.md

A new **`### Receipt printing (thermal) — PAPER WIDTH IS 58mm. DECIDED 2026-08-10.`** subsection in
the **Design System**, which is where layout constraints belong and where someone building the
receipt will actually look. It carries the char/line table for both rolls, the asymmetric-risk
argument, the explicit "we have no printer information — confirm before handoff", the double-width
16-char note, and the derived caps.

**CHECKLIST #2b** updated from `80 / 60 / 200` to `32 / 60 / 200`, with instructions not to edit the
name cap directly (change the constant) and the free-text phone rule spelled out.

---

## 7. Nothing left to commit on settings

```
(this turn)  feat: derive the shop-name cap from a 58mm receipt line
3458ccf      docs: record the settings placeholder and no-format-validation decisions
498581e      feat: settings store and screen for owner-editable shop details
42e5f8f      docs: add shop-details go-live step to the pre-handoff checklist
```

Working tree is clean apart from the untracked
`prisma/migrations/20260809180000_unify_sale_tables_part_a/`, which belongs with the unified-sale
build (CHECKLIST #4) and is deliberately not part of this work.

**Ready for the receipt half.** What it will need from this side: `getSettings()` (one query),
`RECEIPT_LINE_CHARS`, `receiptLine()` for omitting absent optional lines, and the rule that
placeholders print **verbatim** on the receipt even though the form treats them as empty.

---

### Housekeeping

The dev server I started for this verification is still running on **port 3000** (single server,
correct port). Say the word and I'll stop it — last time the background task was killed it left an
orphaned `next` child holding the port, which I cleaned up.

---

### Sources used

The **repository** (searched for any existing printer information — none) and the **running app** in
a real browser for §5. The ESC/POS character-per-line figures are **standard specification values**,
not measured against the owner's hardware — flagged as such in CLAUDE.md, because that distinction
is exactly what "confirm the roll before handoff" is protecting.
