# Logging the login GET-fallback security item + the dev-server note

Date: 2026-08-08
Session: `muneeb inventory dev4`
Source prompt: `docs/prompt.txt` (two follow-ups after Phase 5 closed)

**Docs only. No application code was changed.** Both items were logged in `CLAUDE.md`,
committed as `9598888`, and pushed to `origin/main`.

`git diff --stat` before committing:

```
CLAUDE.md | 75 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++-
1 file changed, 74 insertions(+), 1 deletion(-)
```

---

## 1. Login GET-fallback — recorded as an open security item (must fix)

Added to the **Authentication** section of `CLAUDE.md` under a
`### 🔴 OPEN SECURITY ITEM` heading.

### What is recorded

**Symptom.** When the client JS bundle is absent or has not hydrated, the login form submits
natively. There is no `method` on the `<form>`, so the browser defaults to **GET** and the
credentials land in the query string:

```
/login?email=owner%40example.com&password=<the actual password>
```

**Why it matters.** A password in a URL is written to browser history, server and proxy
access logs, and any `Referer` header sent onward. Those are places credentials are never
rotated out of.

**Honest severity, recorded in both directions.** It was genuinely **reproduced** — the URL
above is what the address bar actually showed during the Phase 5 mobile pass. But it only
appeared while every client chunk was 404ing from a corrupted `.next` (item 2 below), and it
did **not** recur once the chunks served 200. In normal operation the React `onSubmit`
handler intercepts and this path is never taken.

I wrote that up as a reason to **schedule** it, not to dismiss it: "only when JS fails" still
covers a failed deploy, a CDN hiccup, an ad-blocker, or a locked-down corporate browser —
which are exactly the moments a user retypes their password.

**The fix (documented, deliberately not applied):**
- `method="post"` on the `<form>`, so the no-JS fallback is structurally incapable of
  serialising fields into the URL.
- A POST-only handler that rejects non-POST outright.
- **Re-test with JavaScript disabled**, not just with JS working — the bug is invisible in
  the working case, which is why it survived Phases 1–4.

This is Phase 1 code and was out of Phase 5's scope, so nothing was touched.

### Where it is recorded — three places, not one

Deliberately redundant so it cannot get lost in the Phase 8 a11y sweep:

1. The full write-up in the Authentication section.
2. The Phase 8 table row, now reading
   `Polish: mobile nav, states, a11y, PWA, **login POST-only security fix**, final validation`.
3. An explicit blocker note under the phase table: **Phase 8 cannot be marked ✅ while this
   is unfixed.**

---

## 2. Double dev server corrupting `.next` — logged as an operational note

Added as a new **Local development notes** section in `CLAUDE.md`, immediately before
`## Development Phases`. Explicitly labelled **not a code defect**.

Recorded with the recognition cue first, because the symptom impersonates an application bug:

- **Symptom:** the page renders (server HTML is fine) but is completely inert — no hydration,
  buttons do nothing, forms fall back to native submits. Console shows repeated
  `Failed to load resource: 404`. Network shows `main-app.js`, `app-pages-internals.js` and
  every `app/**/page.js` returning **404** while `webpack.js` returns **200**.
- **Cause:** a hard-killed `next dev` leaves port 3000 held, so the next `npm run dev` binds
  **3001** and writes to the same `.next`. Two servers, one build directory — whichever one
  the browser is pointed at now serves chunks the other overwrote.
- **Fix:** kill everything listening on 3000/3001, delete `.next`, start exactly ONE server,
  and confirm the port it actually bound to.

Both the PowerShell kill command and the `rm -rf .next && npm run dev` line are included
verbatim so the next occurrence is a copy-paste, not a re-diagnosis.

This is the direct cause of item 1 being observable at all, which is why the two notes
cross-reference each other.

---

## 3. Commit

| | |
|---|---|
| Commit | `9598888` |
| Message | `docs: log login GET-fallback security item + dev-server note` |
| Pushed to | `origin/main` |
| Files changed | `CLAUDE.md` only |

Phase 5 history for context: `5e5f727` (feature), `c17eb5e` (mobile verification + preview
deploy record), `9598888` (this).

---

## 4. State

- Phase 5: ✅ closed, committed, pushed, preview deploy READY.
- Phase 8: now carries a **blocking** security item that did not exist as a tracked task
  before today.
- Nothing is in progress. Stopped, awaiting Phase 6.

### Still open across the project (unchanged by this turn)

- The login POST-only fix (above) — must fix before handoff.
- The catalog delete-guard 409 re-test, outstanding since Phase 3.
- Phase 8 touch targets: `TabsTrigger` at 28px, to be fixed once app-wide in
  `components/ui/tabs.tsx`, not per usage.
- Real-hardware mobile check — Phase 5 was verified at a CDP-confirmed 360px viewport, which
  is geometry, not a device; soft-keyboard behaviour over the sticky save bar is the one
  thing emulation cannot answer.
