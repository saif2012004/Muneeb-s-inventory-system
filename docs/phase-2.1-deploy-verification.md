# Phase 2.1 — Preview Deploy & Edge-Bundle Verification

**Date:** 2026-08-03
**Commit:** `0f1542b` — `feat: phase 2.1 - catalog API with guarded deletes`
**Result:** ✅ Build succeeded · ✅ Edge bundle clean · ✅ Live behaviour confirmed

---

## 1. Commit & push

Pushed to `origin/main`: `bdd0e19..0f1542b`.

14 files, +1359 / −1:

```
Claude.md                           |  15 ++   # 5.1 documented
app/api/categories/[id]/route.ts    | 102 ++
app/api/categories/route.ts         |  83 ++
app/api/products/[id]/route.ts      | 125 ++
app/api/products/route.ts           | 105 ++
app/api/subcategories/[id]/route.ts |  91 ++
app/api/subcategories/route.ts      |  45 ++
docs/phase-2.1-api-routes.md        | 191 ++
lib/api.ts                          |  50 ++
lib/auth.config.ts                  |  17 +-  # 401 JSON for /api/
lib/catalog-guards.ts               | 103 ++
lib/validations/catalog.ts          | 129 ++
package.json                        |   4 +   # prisma.seed + npm run seed
prisma/seed.ts                      | 300 ++   # NOT run
```

### Secret hygiene confirmed

`git check-ignore -v` output:

| Path | Ignored by |
|---|---|
| `.env` | `.gitignore:32` (`.env*`) |
| `.env.local` | `.gitignore:32` (`.env*`) |
| `.vercel` | `.gitignore:36` |

`git ls-files` shows only `.env.example` tracked — which is the intended negation. No secret
is in the repo.

**Note:** the file is `Claude.md` on disk, not `CLAUDE.md`. Git's index is case-sensitive even
on Windows, so `git add CLAUDE.md` silently stages nothing. It was staged with the correct
casing.

---

## 2. Preview deploy

```
npx vercel deploy        # no --prod
```

| | |
|---|---|
| Preview URL | `https://muneeb-inventory-system-27ajyqz14.vercel.app` |
| Deployment id | `dpl_4G9NK2va59VTJat9aHhyEueby6DE` |
| `readyState` | `READY` |
| `target` | `null` — **preview, not production** |
| Build time | 40s |

Production at `muneeb-inventory-system.vercel.app` is untouched.

Vercel build output:

```
✓ Compiled successfully
ƒ Middleware                             78.2 kB
Build Completed in /vercel/output [40s]
```

---

## 3. Edge-bundle check (Gotcha 3)

### Correction to the earlier report

`docs/phase-2.1-api-routes.md` §5.2 said the local build was broken and the Edge check could
not be run locally. **That was too strong and is now superseded.** The build is not broken —
it OOMs only under memory pressure. With the dev server stopped (~700 MB freed), `npm run build`
completed locally and emitted `ƒ Middleware 78.2 kB`, **byte-identical to Vercel's figure**.

So the check *was* runnable, and was run against a genuine production bundle.

### How it was confirmed

**Step 1 — production bundle, not a dev one.** The first bundle inspected was 2,184,415 bytes
with comments intact: a *dev* artifact left by `next dev`. It was deleted and a fresh production
build run, producing `.next/server/middleware.js` at **240,214 bytes** — matching the 78.2 kB
Vercel reported (that figure is gzipped).

**Step 2 — the documented command, verbatim from CLAUDE.md Gotcha 3:**

```powershell
Select-String -Path .next/server/middleware.js -Pattern '@prisma/client|bcryptjs|PrismaClient|\.prisma'
```

Result:

```
CLEAN - no matches for @prisma/client, bcryptjs, PrismaClient, or .prisma
```

**Step 3 — confirmed the right build was inspected.** Grepping the same bundle for the Phase 2.1
change (`"You must be signed in"`) returns **1 hit**, proving the clean result came from a bundle
that actually contains the new code, not a stale artifact.

**Step 4 — Node built-ins that would break Edge:**

| Pattern | Hits |
|---|---:|
| `require("crypto")` | 0 |
| `require("fs")` | 0 |
| `node:fs` | 0 |
| `node:crypto` | 0 |

**Verdict: the split config holds. No Prisma, no bcryptjs, no Node built-ins in the Edge bundle.**

### ⚠️ The documented grep produces false positives — worth knowing

Run against an **unminified** bundle, the CLAUDE.md command reports `bcryptjs: 2 hits`. Both are
inside the guardrail *comments themselves*:

- `lib/auth.config.ts` — *"Nothing here may touch bcryptjs, the Prisma client, or any Node built-in."*
- `middleware.ts` — *"never lib/auth, which pulls in Prisma and bcryptjs"*

The comments that warn about the trap trip the check that detects the trap. Production builds
strip comments so the check is clean there, but anyone running it against a dev bundle will get
a false alarm. A caveat has been added to Gotcha 3 in CLAUDE.md.

---

## 4. Live behaviour on the preview deployment

The preview sits behind Vercel Deployment Protection, so plain `curl` gets a 302 to
`vercel.com/sso-api` — that is Vercel's auth layer running *before* the app's middleware, not an
app response. Verified through `npx vercel curl`, which handles the bypass.

| Request | Status | Content-Type | Body / Location |
|---|---|---|---|
| `GET /api/categories` | **401** | `application/json` | `{"data":null,"error":"You must be signed in."}` |
| `GET /` | **307** | — | `Location: /login?callbackUrl=…` |
| `GET /login` | **200** | `text/html` | login page renders |

This confirms decision 5.1 in the real Vercel runtime, not just locally: API calls get JSON,
page requests still redirect, and `/login` remains the only public page.

It also confirms `trustHost: true` is doing its job — no `UntrustedHost` failure, and Auth.js
issued its `__Host-authjs.csrf-token` / `__Secure-authjs.callback-url` cookies normally.

**Side effect:** `vercel curl` generated a deployment-protection bypass token for project
`prj_0wN38kb4GjnnqvPpvv1WLoUsvtLF`. Scoped to that project; no action needed, just recorded.

---

## 5. CLAUDE.md updates

1. **Gotcha 3** — new bullet documenting that signed-out `/api/` requests return 401 JSON rather
   than a redirect, with the reasoning, marked *"do not simplify it back to a bare
   `return isLoggedIn`"* so a future session does not revert it.
2. **Authentication** — new bullet explaining the rejection shape differs by request type, and
   that route handlers also call `requireOwner()` as defence in depth.
3. **Gotcha 3 grep caveat** — added after this run, recording the comment false-positive above.
   Not requested; added because the check as written would mislead a future session.

---

## 6. State

| | |
|---|---|
| Phase 2.1 routes | ✅ committed, pushed, deployed to preview |
| Edge bundle | ✅ clean |
| Production | untouched — no `--prod` deploy |
| Database | untouched — 0 catalog rows, `_prisma_migrations` still 2 |
| **Seed (2.3)** | ⛔ written, **not run** |
| **Catalog UI (2.2)** | ⛔ not started |
