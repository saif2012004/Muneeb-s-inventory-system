# "Check the highlighted fields" with nothing highlighted — found and fixed

**Date:** 2026-08-18
**Reported by:** you, from real use on localhost
**Status:** ✅ fixed and verified in the browser · commit `53467ba`

---

## You were right, and the app was lying to you

The fields **were** highlighted. They were **below the fold**, and the page did not scroll.

A bill with four lines is about **1,300px tall** against an **~860px viewport**. When I reproduced
it, **five of nine error messages were off-screen** and `scrollY` stayed at **0** after the failed
submit. So the toast told you to check highlighting you could not see — which is indistinguishable
from the app being broken.

Worse on a phone, where the viewport is shorter still.

### Why the framework didn't save us

react-hook-form focuses the first invalid field by default (`shouldFocusError`). It can only do that
for fields it holds a **ref** for — and the two most likely offenders, the **customer** and
**product** pickers, are custom comboboxes built on buttons, not registered inputs. So the one case
that most needed the jump was exactly the case it couldn't handle.

---

## What it does now

On a failed save it walks the errors **in reading order** — customer, date, each line top to bottom,
then notes — and:

1. **Names the first one in the toast**, e.g. `Item 2 · product — Choose a product`
2. **Scrolls it to the centre of the screen**, and focuses it if it's a focusable control

Verified with the first error on line 2 of a four-line bill: **`scrollY` went 0 → 457**, and the
field moved from y=780 — behind the pinned total bar — to **y=323, centred**. Toast read
`Item 2 · product — Choose a product`.

### The part that matters beyond your report

Naming the field also closes a case the generic message hid **completely**: a field whose error has
**nowhere to render**. The per-line discount is hidden on this screen, and `chilled` / `unitName`
have no error slot at all — if one of those ever failed, the old toast would have left it both
invisible *and* unmentioned, with no way to work out what was wrong. Now it gets named even when it
cannot be highlighted.

---

## An accessibility bug fixed on the way

`<Label htmlFor="customer">` and `htmlFor="sale-date"` pointed at ids **that did not exist**. So:

- clicking either label did nothing (it should focus the control)
- screen readers got no association between the label and the field
- and the new scroll-to-error had no element to aim at

Both pickers now take an `id` that lands on their trigger button. The Customer field now reports
itself as labelled "Customer" rather than as an anonymous button.

---

## Two notes on the database

- **Your two real sales are untouched** — Rs. 5,000 and Rs. 6,000, one line each. I added blank lines
  to one while reproducing, but validation refused the save, so nothing was written.
- **You have two test sales of your own** — Rs. 100, and Rs. 30,400 across 3 lines. **I have left
  them alone.** Delete them whenever you like from `/sales`; deleting restores the stock they took.
  They'll also go in the one deliberate data reset before handover (checklist #2).

---

## One thing deferred, deliberately

I did **not** run the production build. It regenerates the Prisma client, which needs a file your dev
server is holding open, and building into `.next` while you are testing would corrupt the server
you're using. `tsc` and lint are both clean and the fix is verified in the running app — I'll run the
build when you're done testing.

The dev server is still up at **http://localhost:3000** with the fix live (it hot-reloaded).

**File:** `docs/responses/2026-08-18-save-sale-validation-fix.md`
