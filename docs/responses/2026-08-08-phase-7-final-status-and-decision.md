# Phase 7 — final status, and the one decision waiting on you

Date: 2026-08-08
Session: `muneeb inventory dev4`

This is the short standalone summary. The detailed evidence — measurements, tables, method —
is in **`docs/responses/2026-08-08-phase-7-progressive-load-and-context7.md`**; this file
exists so the state and the open decision can be read in one page without digging.

---

## 1. Where Phase 7 stands

| Prompt item | Status |
|---|---|
| 1(a) Progressive dashboard load | ✅ Done, measured, browser-verified |
| 2. Context7 recheck (Prisma 6, shadcn) | ✅ Done — nothing differs, no code change |
| 1(b) Production latency measurement | ⛔ **Blocked** — needs a decision from you (§3) |

Everything else from the original Phase 7 brief was closed earlier
(`docs/responses/2026-08-08-phase-7-completion-audit.md`).

## 2. What changed, in one paragraph

The reports dashboard was holding every tile and chart on its slowest query. It now makes two
independent requests: `/api/reports/summary` (period flows, **one** query) paints the page,
and the new `/api/reports/balances` (the two all-time totals, **six** queries) fills its two
tiles behind their own skeletons.

| | Before | After |
|---|---|---|
| Blocking the page | 9.5s (19.2s before the earlier fix) | **1.70s** |
| Balances, non-blocking | — | 7.73s |

Verified in the browser: fast tiles populated at ~2.5s while both balance tiles were still
skeletons, then resolved. The balances query is not keyed on period, so switching period tabs
reuses the cache with no skeleton flash. **The maths did not change** — the numbers still come
from `lib/receivables.ts` and `lib/milk.ts`, and still match the customers hub (11,000) and
the balance sheet (5,000) exactly.

## 3. The decision waiting on you

I could not measure production latency, and I am not going to publish an estimate dressed up
as a measurement. Attempting it surfaced two findings that matter more than the number:

**Preview deployments reject authenticated requests.** I completed a genuine NextAuth sign-in
against the preview (`/api/auth/session` returns the user), yet every gated route returns 401
and pages 307 to `/login`. `/api/auth/*` sits outside the middleware matcher; everything else
does not — so middleware does not see a session the NextAuth route reads fine. `NEXTAUTH_SECRET`
*is* set for Preview and is passed explicitly with `trustHost: true`, so my leading hypothesis
is `NEXTAUTH_URL` being Production-only. **A preview deploy can therefore only ever be a build
check, never an authenticated verification.** That is true of every phase so far.

**Production is a 6-day-old Phase 1 build.** Every route from Phases 2–7 returns 404 there.
Authentication itself works correctly on production.

So: preview has the routes but rejects the session; production accepts the session but has no
routes. Bridging that needs a `--prod` deploy, which the brief explicitly forbade.

**Pick one and I will finish it:**

1. **Fix preview auth first** (likely `NEXTAUTH_URL`, or making middleware trust the
   per-deployment host), then measure on preview and leave production alone. Also repairs
   preview as a testing surface for every future phase.
2. **Approve one `--prod` deploy.** Production then has the routes and already accepts
   sessions, so the measurement takes minutes — and it stops production sitting five phases
   behind.
3. **Set the function region to `icn1` (Seoul)** to co-locate with the database. A fix rather
   than a measurement; likely collapses the per-query cost outright.

**Recommendation: 1, then 2.** Both are worth doing on their own merits rather than as a side
effect of chasing a number.

## 4. Corrections to things I said earlier

- The deployed function runs in **Mumbai** (`X-Vercel-Id: bom1`), against a **Seoul** database
  (`aws-1-ap-northeast-2`). I had earlier inferred `iad1`/Washington from Hobby defaults —
  that was wrong.
- The Phase 7 prompt did **not** ask for progressive loading. I raised the 9.5s myself as a
  known gap and shipped without fixing it; the later prompt described it as previously
  requested. The fix was right either way — noting it only so the history is accurate.

## 5. Housekeeping

| | |
|---|---|
| Commits | `b6c44ab` (fix), `0af08be` (report) — both pushed |
| Preview deploy | READY — `https://muneeb-inventory-system-7u34wzd3m.vercel.app` |
| Working tree | clean |
| Database | throwaway login and all cookie jars deleted; only your `Saif` customer/farmer and the owner account remain; zero `ZZ_TEST_` rows |
| Dev server | still running on `:3000` — say the word and I'll stop it |

## 6. Still open beyond Phase 7

- **Phase 8**, with the **login POST-only security fix** blocking its ✅.
- The preview-auth defect above — new, and worth its own task.
- Production being five phases stale.
- Reports summary balances still cost ~7.7s from this machine; the split means that no longer
  blocks the page.
- Real-hardware mobile verification — everything so far is CDP emulation.
