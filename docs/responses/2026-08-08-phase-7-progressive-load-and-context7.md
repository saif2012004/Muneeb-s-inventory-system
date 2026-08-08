# Phase 7 close-out — progressive dashboard load + Context7 recheck

Date: 2026-08-08
Session: `muneeb inventory dev4`
Source prompt: `docs/prompt.txt`

**Item 1(a) done and verified. Item 2 done, nothing differs. Item 1(b) — the production
latency measurement — I could NOT complete, and §4 explains exactly why and how to unblock
it.** Committed `b6c44ab`, pushed, preview deploy READY.

One factual correction up front: the Phase 7 prompt did not ask for progressive loading. I
raised the 9.5s myself in §8 of the Phase 7 report as a known gap and shipped without fixing
it. The fix was still the right call — recording this only so the history is accurate.

---

## 1. The progressive load (item 1a) — done

### What was wrong

Every tile, chart and table on the dashboard waited on the slowest query. Outstanding
receivables and money owed to farmers cost **six** database round trips against the period
flows' **one**, because a total of positive balances has to be grouped per customer and per
farmer before it can be summed — a credit must not cancel someone else's debt. So the landing
page held for ~9.5s and crept toward the 15s `api-client` timeout.

### The change

Two independent requests instead of one:

| Endpoint | Contents | Queries |
|---|---|---|
| `/api/reports/summary?period=…` | period flows: revenue, counts, litres | **1** |
| `/api/reports/balances` *(new)* | outstanding receivables, owed to farmers | 6 |

The two balance tiles render their own `Skeleton` while the rest of the page is already
usable. **This is a loading change, not a maths change** — the arithmetic is still delegated
to `getTotalOutstanding()` in `lib/receivables.ts` and `getAllFarmerTotals()` in `lib/milk.ts`.

One design decision worth keeping: **the balances query is deliberately not keyed on period.**
A balance is what is owed right now, not what accrued in a window, so switching period tabs
reuses the cached value instead of re-running six queries.

### Measured, warm, in the browser

| | Before | After |
|---|---|---|
| Blocking the page | 9.5s (originally 19.2s) | **1.70s** |
| Balances (own skeletons, non-blocking) | — | 7.73s |

Run concurrently the way the dashboard actually does it, the summary lands **6.8s ahead** of
the balances (2.95s vs 9.70s — both inflated in dev because one process shares a single
connection; in production each request is its own invocation with its own pool).

### Observed behaviour, not just timings

Sampling the DOM while the page loaded:

```
at ~2.5s   TOTAL REVENUE  Rs. 11,000   BAKERY  Rs. 5,000   MILK SOLD  Rs. 6,000
           OUTSTANDING RECEIVABLES  SKELETON
           OWED TO FARMERS          SKELETON
later      OUTSTANDING RECEIVABLES  Rs. 11,000
           OWED TO FARMERS          Rs. 5,000
```

- Fast tiles populated while the slow two were still skeletons ✅
- The slow tiles resolved rather than hanging ✅ (polled to confirm, no error state)
- **Period switch → balance tiles stayed populated, no skeleton flash** ✅ (the cache win)

### Numbers unchanged, and still matching their source screens

Re-verified against the live endpoints after the split:

| Figure | Reports | Source screen | Match |
|---|---|---|---|
| Outstanding receivables | 11,000 | Customers hub: 11,000 | ✅ |
| Owed to farmers | 5,000 | Balance sheet: 5,000 | ✅ |

(The figures differ from the Phase 7 report because the `ZZ_TEST_` fixture has been removed;
what remains is your own `Saif` data — bakery 5,000 + milk 6,000 = 11,000 revenue, and
30,000 − 25,000 = 5,000 owed. Internally consistent.)

---

## 2. Context7 recheck (item 2) — done, nothing differs

You were right to make me run it rather than reason past it. I ran both and re-read
`lib/reports.ts` against them.

**Result: no differences found. No code change needed.** Two things were confirmed rather
than assumed, and one of them is genuinely load-bearing:

- **Prisma 6 raw queries:** *"Template variables can only be used for data values, not
  identifiers (column names, table names…)"* and *"`$queryRaw` does not support dynamic table
  names in PostgreSQL."* This is exactly why `getTrend` uses `Prisma.raw()` with a fixed,
  allowlisted `TREND_TABLE` map for the table name while binding `${groupBy}`, `${start}` and
  `${end}` as ordinary parameters. Had I interpolated the table as `${table}`, it would have
  been bound as a value and failed. The existing code is correct.
- **Prisma 6 aggregation:** `groupBy` with `_sum` and `orderBy: { _sum: … }` is current v6
  usage, as used in `getTopProducts`. Also noted: *"Prisma sends JavaScript integers to
  PostgreSQL as INT8"* — not applicable here, since the raw queries bind only Dates and a
  string.
- **shadcn:** `Tabs` is controlled via `value` / `onValueChange` (as used), and `Skeleton` is
  a plain `animate-pulse` div (as used).

So the reasoning in my audit held up — but the rule earned its keep anyway, by confirming the
`Prisma.raw` identifier requirement rather than leaving it as something I believed.

---

## 3. Production behaviour that WAS verified

Through `vercel curl` (which bypasses Vercel Deployment Protection), against the deployed
preview:

```
GET /api/reports/summary?period=month
{"data":null,"error":"You must be signed in."}
```

That confirms in **production** what CLAUDE.md specifies and what has only been checked
locally until now: a signed-out request under `/api/` returns the **401 JSON envelope**, not a
307 to the HTML login page. Worth having.

---

## 4. Item 1(b) — production latency: NOT MEASURED, and exactly why

I got much further than "blocked", and found two things worth more than the number itself.
**I am not going to estimate a latency and present it as a measurement.**

### What I got working

Using the Vercel MCP `get_access_to_vercel_url` tool I obtained a `_vercel_share` bypass link,
carried its cookie in a `curl` jar, completed the **full NextAuth credentials sign-in against
the deployed preview**, and confirmed a real session:

```
GET /api/auth/session
{"user":{"name":"Owner","email":"zz_test_milk@example.test", ...}}
```

So Deployment Protection was solved, and the app authenticated me.

### Finding 1 — preview deployments reject authenticated requests

With that valid session:

| Request | Result |
|---|---|
| `GET /api/auth/session` | 200, returns the user |
| `GET /api/reports/balances` | **401** `{"data":null,"error":"You must be signed in."}` |
| `GET /reports` (page) | **307 → /login** |

`/api/auth/*` is excluded from the middleware matcher; everything else is not. So the session
is valid, the NextAuth route reads it fine, and **the middleware does not**. On a preview
deployment you can sign in and still be locked out of every page and API route.

It is not the secret: `vercel env ls` confirms `NEXTAUTH_SECRET` is set for **Preview and
Production**, and `lib/auth.config.ts` passes it explicitly with `trustHost: true`.
The one environment difference is **`NEXTAUTH_URL`, which is set for Production only** — that
is my leading hypothesis, stated as a hypothesis, not a conclusion.

**Consequence for the workflow:** preview deployments cannot be used for any authenticated
verification. Every phase so far has treated "preview deploy READY" as a build check only,
which is exactly what it is worth — but it is now clear it can never be more than that until
this is fixed.

### Finding 2 — production is a 6-day-old Phase 1 build

Running the same flow against `https://muneeb-inventory-system.vercel.app`:

| Request | Result |
|---|---|
| `/customers` signed OUT | 307 → /login |
| `/customers`, `/beverages`, `/milk`, `/reports` signed IN | **404** |

Two things follow. First, **authentication works correctly on production** — signed out
redirects, signed in passes middleware and reaches the router. Second, **none of Phases 2–7
are deployed**: every route 404s because production still serves the Phase 1 scaffold. The
production deployment is 6 days old, consistent with only preview deploys since.

### Why the number is therefore unobtainable right now

- Preview **has** the reports routes but rejects the session → cannot measure.
- Production **accepts** the session but has no reports routes → cannot measure.
- Promoting with `--prod` would bridge that, and your prompt explicitly said **no `--prod`**,
  so I did not.

### Supporting evidence gathered

- The database is in **AWS Seoul** — `aws-1-ap-northeast-2.pooler.supabase.com`.
- The deployed function runs in **Mumbai** — `X-Vercel-Id: bom1::…`. (I had earlier inferred
  `iad1`/Washington from Hobby defaults; the header shows that was wrong.)

Mumbai→Seoul is roughly 5,000 km, so production should be meaningfully faster than my
Pakistan→Seoul link, but is **not** co-located and will not be free. That is geography, not a
measurement, and should be read as such.

**This is exactly why the split matters.** Whether the balances turn out to cost 300ms or 3s
in production, the dashboard now paints on one query and the two slow tiles fill in behind
skeletons. The owner is protected either way — the outcome you specified.

### To finish 1(b) — pick one

1. **Approve one `--prod` deploy.** Production then has the routes and already accepts
   sessions, so I can measure both endpoints immediately. Cleanest, and it also stops
   production sitting six days and five phases behind.
2. **Fix preview auth first** (likely `NEXTAUTH_URL`, or making middleware trust the
   per-deployment host), then measure on preview and leave production alone. Also fixes
   preview as a testing surface permanently.
3. **Set the function region to `icn1` (Seoul)** to co-locate with Supabase. That is a fix
   rather than a measurement and would probably collapse the per-query cost, but it is a
   deployment change and therefore your call.

My recommendation is **2 then 1**: preview auth being broken is worth fixing on its own
merits, and production being five phases stale is worth correcting deliberately rather than
as a side effect of a measurement.

---

## 5. Housekeeping

- Commit `b6c44ab` — `fix: phase 7 - progressive dashboard load + context7 recheck`, pushed.
- It also carried the two previously-uncommitted response files (orphaned dev server, Phase 7
  audit).
- Preview deploy **READY**, `target: preview`: `https://muneeb-inventory-system-7u34wzd3m.vercel.app`
- Throwaway login deleted. Remaining in the database: your `Saif` customer and farmer, and the
  owner account `i228767@nu.edu.pk`. Zero `ZZ_TEST_` rows.
- Dev server left running on :3000 from this session — say the word and I'll stop it.

## 6. Phase 7 status

Everything in the prompt is closed **except 1(b)**, which is blocked on access rather than on
work. Phase 8 remains open, with the **login POST-only security fix** still blocking its ✅.
