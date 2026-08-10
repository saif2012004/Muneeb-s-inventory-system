# Login POST-only security fix — CHECKLIST #1, closed

**Date:** 2026-08-10
**Scope:** go-live blocker #1 only. No migrations, no other checklist items.
**Result:** fixed, verified with JavaScript genuinely disabled, committed and pushed.
**Status change:** CHECKLIST #1 `[ ] open` → `[x] closed`. No longer blocks go-live or Phase 8.

---

## 1. Doc source used

**Context7 — connected**, queried `/nextauthjs/next-auth` for "signIn server-side in a Route
Handler vs Server Action, credentials provider, redirectTo".

**Plus `node_modules`, which is where the three decisions that actually shaped the fix came from.**
Context7 gives you the happy path; the installed source told me what would really run:

| Question | Source | Answer |
|---|---|---|
| Does `onSubmit` + a form `action` double-submit? | `next/dist/compiled/react-dom/cjs/react-dom.development.js:29545` | No — `submitForm()` starts `if (nativeEvent.defaultPrevented) return`, and the SimpleEventPlugin (which dispatches `onSubmit`) is extracted **before** the form-action plugin at line 32087/32114 |
| Does react-hook-form preventDefault synchronously? | `react-hook-form/dist/index.cjs.js` | Yes — `async r => { r && (r.preventDefault && r.preventDefault(), …) }`, before any `await` |
| What status does `redirect()` return in a Route Handler? | `next/dist/client/components/redirect.js:74` | **307**, not 303 — it only uses `SeeOther` when `actionStore.isAction`. Decisive; see §3 |
| Does `signIn` throw on a bad password? | `@auth/core/index.js:118` | Yes — `if (isAuthError && isRaw && !isRedirect) throw error`. **But not on a config error**, which returns a 500 earlier at line 84. That distinction became a real bug; see §4 |
| Do cookies set in a Route Handler survive a manually-returned Response? | `next/dist/server/future/route-modules/app-route/module.js:285` | Yes — `appendMutableCookies` merges them into whatever you return |

---

## 2. The bug, restated from the code

`components/auth/login-form.tsx` had:

```jsx
<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
```

No `method`. No `action`. Server-rendered HTML confirmed it — this is what `curl http://localhost:3000/login` returned before the change:

```html
<form class="space-y-4" noValidate="">
```

With the client bundle absent or not yet hydrated, that form submits **natively**, and a `<form>`
with no `method` defaults to **GET**. Email and password go into the query string, which is written
to browser history, server and proxy access logs, and any onward `Referer` — places credentials are
never rotated out of.

---

## 3. What shipped

**Four files. No migration, no dependency, no change to the signed-in flow.**

### `app/api/auth/no-js-login/route.ts` (new)

A route that exports **`POST` only**. Next answers every other method with 405 automatically, so the
credential path is structurally incapable of accepting a query string.

Four things in it are deliberate:

1. **It lives under `/api/auth/`.** The middleware matcher excludes that prefix. Anywhere else under
   `/api/`, a signed-out POST would be answered with the 401 envelope from the `authorized` callback
   and never reach the handler. The hyphen in `no-js-login` keeps it from colliding with any Auth.js
   action on the `[...nextauth]` catch-all.
2. **It returns 303, and calls `signIn` with `redirect: false`.** This is the one that would have
   silently broken things: `redirect()` from `next/navigation` issues **307** inside a Route Handler,
   and 307 *preserves the method* — the browser would have re-POSTed the credentials to `/`. The
   session cookie still arrives because Next merges `cookies()` writes into the returned Response.
3. **It brings its own CSRF check** (Origin, falling back to Referer), because `signIn` calls
   Auth.js with `skipCSRFCheck`. Without it, a cross-site form could log the owner into an
   attacker's account.
4. **It re-sanitises `callbackUrl` server-side** — same rule as the client's `resolveCallbackUrl`:
   resolve against our own origin, drop anything off-site, never bounce back to `/login`.

### `components/auth/login-form.tsx`

```jsx
<form method="post" action={NO_JS_LOGIN_ROUTE} onSubmit={form.handleSubmit(onSubmit)} …>
  <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />
```

Plus an `initialError` prop, so the no-JS user sees why a login failed.

**The JS-enabled path is untouched.** RHF's `handleSubmit` calls `preventDefault()` synchronously,
so the native submit is cancelled and `signIn()` from `next-auth/react` runs exactly as before —
confirmed in the network log at §4.4, which still shows `/api/auth/callback/credentials` and never
touches the new route.

### `app/(auth)/login/page.tsx`

Reads `?error=` and maps the code to a **fixed** string. The code is never rendered, so a crafted
`?error=<anything>` cannot put attacker text on the login page.

### `lib/routes.ts`

`NO_JS_LOGIN_ROUTE`, with the reason it must stay under `/api/auth`.

---

## 4. Verification

> **This is the part that matters.** The bug is invisible with JS on — that is how it survived
> seven phases. A green build proves nothing about it.

### 4.0 How JS was actually disabled

`chrome-devtools`' `emulate` has no JS toggle, so script execution was killed at document start by
injecting `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` into `<head>`
before the parser reached any script. Each run used a **fresh isolated browser context** (own cookie
jar — `document.cookie` cannot clear the HttpOnly session cookie, which cost one false start).

**Proof the page was genuinely script-free**, read from the live page:

```json
{"scriptTagsInDoc": 12, "nextRuntimeLoaded": "undefined", "nextFlightPayload": "undefined",
 "formMethod": "post", "formAction": "/api/auth/no-js-login"}
```

Twelve `<script>` tags present in the document, **none executed** — `window.next` and
`window.__next_f` both undefined, no hydration. That is the reported condition reproduced.

### 4.1 JS DISABLED — correct password (the headline result)

Started at `/beverages` while signed out → middleware bounced to
`/login?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fbeverages`. Typed the credentials, clicked
**Sign in**. The captured request:

```
POST http://localhost:3000/api/auth/no-js-login          <- no query string
Status: 303
sec-fetch-mode: navigate                                  <- a real browser navigation, not fetch

Request Body:
  callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fbeverages&email=zz_test_nojs%40example.com&password=ZZtest-nojs-2026%21

Response Headers:
  location:   http://localhost:3000/beverages
  set-cookie: authjs.session-token=eyJhbGciOiJkaXIiLCJlbmMiOi…; Path=/; HttpOnly; SameSite=lax
```

**The credentials are in the request BODY. The URL is bare.** Address bar afterwards, read from the
page itself:

```json
{"addressBar": "http://localhost:3000/beverages",
 "urlHasEmail": false, "urlHasPassword": false,
 "title": "Beverages · Business Manager"}
```

Signed in, landed on the deep link, **nothing in the URL**. Document redirect chain, end to end:

```
GET  /login?callbackUrl=…%2Fbeverages   200
POST /api/auth/no-js-login              303
GET  /beverages                         200
```

Compare with what the old code produced: `/login?email=owner%40example.com&password=<password>`.

### 4.2 JS DISABLED — wrong password

→ `http://localhost:3000/login?error=CredentialsSignin`, rendering **"Incorrect email or
password."** server-side. Same vague wording as the JS path, so the no-JS route is not an
account-enumeration oracle. No credentials in the URL.

### 4.3 GET to the credential path is rejected

```
GET /api/auth/no-js-login?email=…&password=…   ->  405        <- the old bug's exact shape
GET /api/auth/no-js-login                      ->  405
HEAD /api/auth/no-js-login                     ->  405
PUT  /api/auth/no-js-login                     ->  405
```

Not a redirect, not a silent ignore — **405 Method Not Allowed**. The route exports no GET, so
there is nothing to reach.

Two related guards, also confirmed:

```
POST with Origin: https://evil.example.com       -> 303 -> /login?error=CredentialsSignin   (CSRF)
POST callbackUrl=https://evil.example.com/steal  -> 303 -> /                (no open redirect)
```

### 4.4 JS RE-ENABLED — normal login unchanged

Fresh context, hydration confirmed (`window.next` is an object).

- **Bad password** → spinner "Signing in…", **no navigation** (proving `preventDefault` suppressed
  the native POST), then "Incorrect email or password." in place, button re-enabled, URL still
  `/login`.
- **Good password** → lands on `http://localhost:3000/` — Dashboard.
- **Network trail — the new route is never touched:**
  ```
  GET  /api/auth/providers              200
  GET  /api/auth/csrf                   200
  POST /api/auth/callback/credentials   200      <- the pre-existing client path
  GET  /?_rsc=…                         200
  ```
- **Console: zero errors and zero warnings**, so the added `method`/`action`/hidden input introduce
  no hydration mismatch.

### 4.5 Build and edge bundle

```
tsc --noEmit    clean
next lint       ✔ No ESLint warnings or errors
next build      green
```

Edge-bundle check per Gotcha 3, run against the **production** artifact (234.6 KB, minified — not
the dev bundle that gives false hits):

```
Select-String .next/server/middleware.js -Pattern '@prisma/client|PrismaClient|bcryptjs|\.prisma'
-> clean
.next/server/app/api/auth/no-js-login/route.js -> present
```

---

## 5. Two bugs found *during* verification, both fixed

Neither was visible to `tsc`, lint, or the build. Both are now guarded in code with the reasoning
attached.

**a) A broken auth config read as a successful login.** The first run 303'd to `/` for a browser
that had no session, which then bounced to `/login` with no explanation. Cause: Auth.js does **not**
always throw — when `assertConfig` rejects the config it returns a 500 *before* the raw/throw path,
so `signIn` resolves normally, sets no cookie, and hands back its own endpoint URL. The route now
checks that the URL `signIn` resolved to is the callback target it asked for, and fails closed to
`?error=Configuration` otherwise.

**b) Deep links were being dropped.** Signing in from `/beverages` landed on `/`. The middleware
writes `?callbackUrl=http://host/beverages` — an **absolute** URL — and my first server-side
resolver accepted relative paths only. Now it resolves against our own origin and accepts
same-origin absolute URLs, matching the client's `resolveCallbackUrl`. Re-verified: §4.1 lands on
`/beverages`.

---

## 6. Environment note (not a code change, but it will bite the next session)

**`.env` was missing from this checkout** and every request was logging `MissingSecret` — while the
app still rendered `/login` perfectly happily. Recreated with
`vercel env pull .env --environment=preview --yes`, then **trimmed**: the pull also writes
`VERCEL=1`, and `useSecureCookies: process.env.VERCEL === "1"` then issues a `Secure` cookie that
the browser **drops over plain-http localhost** — you sign in, get a 200, and are still signed out.
Kept `DATABASE_URL` / `DIRECT_URL` / `NEXTAUTH_SECRET`, added
`NEXTAUTH_URL=http://localhost:3000`. `.env*` is gitignored (`.gitignore:32`), verified with
`git check-ignore`. **Written up in CLAUDE.md → Local development notes.**

---

## 7. Test data

Testing needed a password I knew, and I did not want to reset the owner's. Created
`zz_test_nojs@example.com` (`ZZ_TEST_` scoped, per the standing habit that keeps the go-live data
reset a single decision), used it for every run above, then **deleted it**. `User` re-verified back
to baseline: one row, the real owner, `i228767@nu.edu.pk`. The owner's account and password were
never touched.

---

## 8. CLAUDE.md changes (same commit, per the process rule)

- **Authentication** — the "🔴 OPEN SECURITY ITEM" section replaced by the load-bearing rule:
  `method`/`action` must stay, the route is POST-only, and the four non-obvious decisions (why
  `/api/auth/`, why 303-not-307, why the resolved-URL check, why its own CSRF check).
- **CHECKLIST #1** → `[x]` closed, with the verification evidence.
- **Closed items list** → new entry.
- **Blocker table + phase 8 row + the "four items block go-live" line** → updated to three.
- **Local development notes** → the `.env` / `VERCEL=1` trap from §6.

---

## 9. Commit

```
fix: login POST-only, no credentials in URL on no-JS fallback
```

Pushed to `main`.

---

## 10. What is still open

Stopping here as instructed. Remaining go-live blockers: **#2 / #2b** (data reset + owner's real
shop details) and **#3** (Vercel Pro + Supabase backups). Phase 8 stays ⬜ — its polish items (10
touch targets, 11 PWA, 12 date locale, 13 on-device mobile) are untouched.
