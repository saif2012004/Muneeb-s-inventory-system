# Saving and page loads — what I found, and what I changed

**Date:** 2026-08-19
**Commit:** `193acef` (follows `8c2bbdc`, the pooler fix)
**Server:** running at http://localhost:3000

---

## First: I was wrong about relationJoins, and I want to be straight about it

I told you a sale was 12 round trips with **"four of them a product lookup"** that `relationJoins`
would collapse. I enabled it, measured, and it changed **nothing**:

```
default strategy        246 ms   1 query
relationLoadStrategy    237 ms   1 query
identical results: YES
```

**Prisma 6 already collapses a nested `select` into one statement.** The four-query fan-out that flag
exists to fix comes from `include` — and my earlier measurement used a *mirror script I wrote with
`include`*, not the real route, which has always used `select`. I measured my own test, not your app.

So I **removed** the preview feature rather than leave it enabled doing nothing, and recorded the
finding in `prisma/schema.prisma` so nobody re-enables it hoping for a win.

Then I measured the actual route.

---

## What was really slow, counted query by query

I turned on Prisma's query log and counted the statements for **one real save** and each screen's
endpoint. No guessing:

| Endpoint | Round trips | Time |
|---|---|---|
| `/api/products` | 1 | 246 ms — already optimal |
| `/api/reports/summary` | 1 | 239 ms — already optimal |
| `/api/customers` | 3 | 580 ms |
| **`/api/sales`** (the list) | **4** | **764 ms** |
| **`POST /api/sales`** (the save) | **9** | **2,939 ms** |

Two things stood out, and neither was what I had predicted.

### The sales list was paying for a transaction it did not need

It ran `$transaction([findMany, count])`. `BEGIN` and `COMMIT` are round trips too, so **two of its
four trips did no work** — about 460 ms of the 764 ms.

That transaction existed so the page and the total could not disagree about how many rows exist. Real
guarantee — but it needs a **second person** writing a sale in the gap between two queries, and there
isn't one. Worst case now: a pager offers an empty page, which fixes itself on the next load.

### The save was re-reading what it had just written

The create used `select: { id: true }`, then read the sale back **after** `COMMIT` with a second
query. The comment explaining why was still there:

> *"at ~1.1s per round trip a deep join in here spends the timeout budget holding row locks"*

**That premise expired when a round trip became 230 ms.** The split was costing two extra trips
outside the transaction to avoid one join inside it. Holding a lock ~230 ms longer to save ~460 ms of
wall clock is the right way round for a single-user app.

---

## What I changed

1. **Sales list:** two concurrent reads instead of a four-trip transaction.
2. **Save:** the customer check and the product load now run together — they are independent.
3. **Save:** the write returns the full sale, so there is no read-back after `COMMIT`.

Points 1 and 2 are **only safe because of the earlier pooler change** — `connection_limit` went from
1 to 5, so two queries at once genuinely run at once. At 1 they would have queued and gained nothing.

## The result

| | Before today | After the pooler fix | After these cuts |
|---|---|---|---|
| **Sales list** | ~3.5 s | 764 ms | **245 ms** |
| **Saving a sale** | ~3–4 s | 2,939 ms | **~1,600 ms** |
| Products / catalog | ~1.2 s | 246 ms | 246 ms |
| Reports summary | ~1.1 s | 239 ms | 239 ms |
| Customers | 3.2 s | 580 ms | 580 ms |

Verified after each change: the save response still carries the customer, items, `unitName`,
`unitFactor` and total; stock moved 100 → 76 → 100 across a create and delete; build green; both
bundle guardrails clean.

---

## Why saving is still ~1.6s, and what would actually fix it

A save is now **7 round trips**, and 6 of them are the transaction itself:

```
BEGIN → update stock → insert Sale → insert SaleItem → select the detail → COMMIT
```

**Prisma's interactive transactions cost one round trip per statement.** That is the floor without
rewriting the whole write as hand-rolled SQL, which I would not recommend — this is the code path
that guarantees stock and money move together, and it is the last place to trade clarity for speed.

So the arithmetic is simply `7 × 230 ms`. **The 230 ms is the distance to Seoul.**

> **From Mumbai (`ap-south-1`) the same 7 trips would be ~350 ms.** The region is now the biggest
> remaining lever by a wide margin — bigger than any further query-count work. It also speeds up
> local development, unlike moving the Vercel function.
>
> ⚠️ Supabase cannot move a project's region in place: it means a new project and a migration into
> it, with new connection strings and keys. A gated job, best done at go-live alongside the Pro
> upgrade.

## And a reminder about production

Your Vercel `DATABASE_URL` **still points at `:6543`**. None of today's speed reaches production until
you change it in the Vercel dashboard.

---

## About "changing pages still takes 2–3 seconds"

Part of what you feel locally is **not the app**: `next dev` compiles each route the first time you
visit it, which is why the first hit of a screen is several seconds and the second is fast. That
disappears entirely in a production build.

The rest is real and is what the table above measures. If a screen still feels slow after this,
tell me **which** one and I will count its queries — that is now a five-minute job rather than
guesswork.

**File:** `docs/responses/2026-08-19-save-and-page-speed.md`
