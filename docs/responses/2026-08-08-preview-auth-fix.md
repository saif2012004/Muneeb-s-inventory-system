# Preview-auth defect — diagnosed, fixed, verified

Date: 2026-08-08
Session: `muneeb inventory dev4`
Source prompt: `docs/prompt.txt`

**All four items done.** The preview-auth defect is fixed and verified on a real deployment;
the region mismatch and the deploy-reality caveats are logged in CLAUDE.md; no `--prod` deploy
was made; Phase 7 is now fully ✅.

One bonus: fixing the auth defect made the production latency number obtainable for free, so
you have it after all — and it changes the conclusion (§4).

---

## 1. The defect, properly diagnosed

Your hypothesis was close but not quite it. `NEXTAUTH_URL` being Production-only **is** the
trigger, but the mechanism is the session-cookie NAME.

Auth.js decides whether to use `__Secure-`-prefixed cookies from whether it believes the site
is https, and it reads that from the resolved auth URL. Measured by capturing `Set-Cookie` on
a real sign-in against both deployments:

```
production  ->  Set-Cookie: __Secure-authjs.session-token=…; Secure; HttpOnly; SameSite=Lax
preview     ->  Set-Cookie: authjs.session-token=…;          HttpOnly; SameSite=Lax
```

With `NEXTAUTH_URL` unset on preview, Auth.js could not conclude the site was https and chose
the **insecure** cookie name. The sign-in route and `/api/auth/*` used that same name, so they
worked — which is exactly why `/api/auth/session` returned the user and made it look like the
session was fine. The **edge middleware**, handling an https request, looked for
`__Secure-authjs.session-token`, found nothing, and treated every request as signed out.

That is the whole defect: **one half of the app wrote one cookie name and the other half read
a different one.**

## 2. The fix

Pinned the value in `lib/auth.config.ts` so it is never inferred:

```ts
useSecureCookies: process.env.VERCEL === "1",
```

Both halves now read the same static field from the one shared config object (`lib/auth.ts`
spreads `...authConfig`), so they cannot disagree. It is `true` on any Vercel deployment —
preview and production alike, both https — and `false` locally, where `next dev` is plain http
and a `Secure` cookie would simply be dropped by the browser.

I chose this over the alternatives deliberately:

- **Setting `NEXTAUTH_URL` for Preview** cannot work cleanly — every preview deployment has a
  different hostname, so a single stored value would be wrong for all but one.
- **Making middleware trust the per-deployment host** was your other suggestion, and
  `trustHost: true` already does that. Host trust was never the problem; the cookie name was.

## 3. Verified on a real preview deployment

Deployed `https://muneeb-inventory-system-n2osbmr1r.vercel.app`, obtained a Vercel share
bypass, and completed a genuine NextAuth credentials sign-in.

**Cookie now issued on preview:** `__Secure-authjs.session-token` ✅ (matches production)

| Gated route, WITH a real session | Before | After |
|---|---|---|
| `/reports` | 307 → /login | **200** |
| `/customers` | 307 → /login | **200** |
| `/milk/balances` | 307 → /login | **200** |
| `/api/reports/balances` | 401 | **200** |
| `/api/reports/summary?period=month` | 401 | **200** |

You asked for one gated route to return 200. Five do.

**The signed-out contract is intact** — this fix did not weaken the gate:

| Signed OUT (bypass cookie only) | Result |
|---|---|
| `/reports` | **307 → /login** |
| `/api/reports/balances` | **401** `{"data":null,"error":"You must be signed in."}` |

Which is exactly the behaviour CLAUDE.md specifies: pages redirect, `/api/` returns the JSON
envelope.

## 4. Bonus — the latency number, and it changes the conclusion

You told me to skip this rather than deploy early to chase it. Agreed, and I did not deploy to
production. But fixing preview auth made the deployed function reachable, so the measurement
cost nothing:

| Endpoint | Queries | Deployed, warm |
|---|---|---|
| `/api/reports/summary` | 1 | **~1.75s** |
| `/api/reports/balances` | 6 | **~6.4s** (≈**1.07s per query**) |

**The ~1.1s/query floor is real in production. It was never a dev-machine artifact.** The
hypothesis in the earlier prompt — that production might be co-located and far faster — does
not hold.

Which means the progressive load is not a nice-to-have: without it the dashboard would be a
~8s landing page **in production**, not just locally.

### And a correction I owe you

`X-Vercel-Id: bom1::iad1::…` has **two** region segments. The first is only the edge PoP that
accepted the request (Mumbai — nearest to Pakistan); the second is where the function actually
executed: **`iad1`, Washington DC**.

So my original inference (`iad1`, from Hobby defaults) was right, and the "correction" I issued
last turn — claiming the function runs in Mumbai — was wrong. I over-corrected on partial
evidence: the earlier `bom1::xl88g-…` I saw was a middleware 401 that genuinely ran at the
edge, so there was no function segment to see. Both readings were accurate for what they
measured; my interpretation of the second was not.

Net effect: function in **Washington DC**, database in **Seoul** — ~11,000 km per query, which
is precisely the floor above.

## 5. CLAUDE.md updates

- **New handoff infra item** in Deployment posture: the `iad1` ↔ `ap-northeast-2` mismatch,
  with the measured numbers, flagged as a go-live fix (set function region to `icn1`, or move
  the Supabase project) and explicitly **not** to be done mid-build.
- **New "Deployment reality check"** section stating plainly that preview deploys were
  build-checks only through Phases 1–7, why, that it is now fixed, and that production is
  deliberately a Phase-1 build that goes live at handoff — with "do not `--prod` deploy to
  chase a number" written down.
- **Authentication section** now documents the pinned `useSecureCookies` alongside
  `trustHost`, so the next person does not remove it.
- **Phase 7 marked ✅.** The latency measurement is recorded as delivered rather than dropped,
  since it came for free.

## 6. Housekeeping

| | |
|---|---|
| Preview (with fix) | `https://muneeb-inventory-system-n2osbmr1r.vercel.app` — READY |
| `--prod` deploy | **none**, as instructed |
| Database | throwaway login and all cookie jars deleted; only your `Saif` customer/farmer and the owner account remain |
| Dev server on `:3000` | **stopped**, as instructed |

## 7. Open for Phase 8

- The **login POST-only security fix** — still blocks closing Phase 8.
- App-wide 28px `TabsTrigger` touch-target sweep.
- Mobile nav, remaining a11y, PWA (`start_url` and `scope` both `"/"`).
- Real-hardware mobile verification — everything so far is CDP emulation.
- At handoff, not now: the region co-location, Vercel Pro, Supabase Pro (backups), and the
  first production deploy.
