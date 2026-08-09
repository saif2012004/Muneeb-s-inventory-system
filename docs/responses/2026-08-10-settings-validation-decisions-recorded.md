# Validation decisions recorded in CLAUDE.md. One cap raised. Settings already committed.

**Date:** 2026-08-10
**Status:** ✅ Decisions recorded. ✅ One real change made (phone cap). ⏸️ Receipt not started.

---

## 0. Two things were already true

**No format validation existed.** Nothing in the shipped code checks the shape of a phone number or
an address — only `.trim()` and a max length, exactly as you've now specified. So there was nothing
to remove; the instruction is now written into CLAUDE.md so it stays that way.

**The settings store + screen were already committed**, last turn, as
`498581e feat: settings store and screen for owner-editable shop details` — migration, model, seven
new files, nav entry. Nothing was left uncommitted.

**Naming note:** the single constant you refer to as `PLACEHOLDER_SENTINELS` exists, but it is
called **`SETTINGS_PLACEHOLDERS`** in `lib/settings-display.ts`. I've left the name alone rather
than rename to match the description — the important property is that there is exactly one of it,
and the migration's seed INSERT matches it.

---

## 1. The one real change: the phone cap was too tight

Your reasoning names the case explicitly — *"multiple numbers"* — and my cap would have broken on it:

```
"0300-1234567 / 042-35678901".length  ->  27
```

Against a **30-character** cap, that is three characters of headroom. Add a space, a bracket, or a
third number and the field rejects something entirely valid — **the exact false rejection the
no-format rule exists to prevent**, just arriving through a length check instead of a regex.

**Raised to 60** in both the server schema (`lib/validations/settings.ts`) and the client form
schema (`components/settings/SettingsForm.tsx`), which must agree or the browser and the API
disagree about what is acceptable. Final caps:

| Field | Cap | Why |
|---|---|---|
| Shop name | 80 | One receipt header line |
| Phone | **60** | Two numbers plus an extension, comfortably |
| Address | 200 | A free-form address without a paste breaking the layout |

They exist for **receipt layout only** — that is now stated in the code comment, so nobody later
reads them as validation and "completes" them with a format check.

---

## 2. Verified in the browser — the case you named

The dev server was already running, so I tested the actual scenario rather than trusting a constant:

| | |
|---|---|
| Entered | `0300-1234567 / 042-35678901 (shop, ext 12)` — **42 characters**, two numbers and an extension |
| Under the old cap | would have been **rejected** at 30 |
| Result | ✅ **Saved.** `shopPhone` = that exact string, `length = 42`, `configuredAt` stamped, `shopAddress` NULL (left blank) |

Row then restored to its seeded state — `SET SHOP NAME IN SETTINGS` / `SET PHONE IN SETTINGS` /
`SET ADDRESS IN SETTINGS`, `configuredAt` back to **NULL** — so CHECKLIST #2b still reads as
outstanding, which it is.

`tsc --noEmit` exit 0, `next lint` clean.

**One honest note about the test run:** two earlier attempts to save didn't submit at all — the dev
log recorded **no PATCH request**, so nothing reached the server. That was my automation, not the
app: programmatically setting an input's value does not update react-hook-form's internal state, and
one coordinate click landed a few pixels below the button after a viewport re-layout. Driving it
with real keystrokes and Enter saved immediately. The app-side path is proven by that save plus the
four from last turn — but it is worth recording, because "the button did nothing" is exactly what a
real bug looks like, and the thing that distinguished them was checking the server log for a request
rather than trusting the screen.

---

## 3. What went into CLAUDE.md

Both decisions are now in **CHECKLIST #2b**, under a heading that says what they are:

> ##### 🔒 Two decisions here are LOAD-BEARING. Do not soften either one.

**1. The placeholders stay jarring, and they are defined ONCE.** `SETTINGS_PLACEHOLDERS` in
`lib/settings-display.ts` is the single constant and the migration's seed must match it. Explicitly:
*do not "improve" the copy to something friendly — the whole value of the string is that it cannot
be mistaken for a real shop name on a printed receipt.*

The entry also records the **asymmetry**, since that is the part a fresh session would most likely
flatten:

| Where | Behaviour |
|---|---|
| **The Settings form** | Treated as EMPTY — blank input, sentinel as the `placeholder` attribute, rose warning banner |
| **The receipt** | Printed verbatim, shouting |

…plus why the form must not pre-fill them (otherwise "fix the name and save" silently promotes the
untouched phone sentinel into a real value) and that the server rejects a submitted placeholder as
the backstop.

**2. No format validation on phone or address — only trim and a max length.** With the reasoning
that makes it stick rather than just the rule:

> There is no standard format — two numbers, a landline plus a mobile, an extension, an address
> written however his customers recognise it. **A format check is far more likely to reject
> something valid than to catch a real error**, and a real error is one he sees on his own receipt
> and fixes in thirty seconds. A phone regex would be a stranger telling a shop owner his own phone
> number is wrong.
>
> Strictness belongs in the money maths, not in free-text contact details.

The 27-vs-30 arithmetic is recorded there too, so the next person to look at the cap knows why it is
60 and does not "tidy" it back down.

The same no-format reasoning is duplicated as a block comment at the top of
`lib/validations/settings.ts` — deliberately, because that is the file someone has open when the
temptation to add a regex strikes, and they may never scroll CLAUDE.md that far.

Also corrected in #2b: the entry said the item "depends on the Settings table shipping first". It
has shipped, so it now says so and scopes the remaining work to the owner typing his details in.

---

## 4. Committed

```
docs: record the settings placeholder and no-format-validation decisions
```

CLAUDE.md, the two cap changes, the comment block, and this response. The feature itself was
committed last turn as `498581e`.

Stopping here for the receipt half.

---

### Housekeeping

A dev server from this session is still running in the background on **port 3000** (single server,
correct port). Kill it with the snippet in CLAUDE.md's local-development notes if you want it gone.

---

### Sources used

The repository and the running app — the caps were checked against the real code, and the 42-character
phone was saved through the real form and confirmed with SQL against the live row. No library lookup
was needed, so neither Context7 nor `node_modules` was consulted this turn.
