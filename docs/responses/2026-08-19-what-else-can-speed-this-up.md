# "Would Redis help?" — measured answer: no, and here is what does

**Date:** 2026-08-19
**Short version:** Redis is a poor fit for this app. The region move is worth more than everything
else on this page combined, and the second-biggest lever is one you already have switched on.

---

## What I measured before answering

Row **count** is free. Payload **size** is not. That was the surprise:

| Query | Median |
|---|---|
| `SELECT 1` (does no work) | **~230 ms** |
| Settings — 1 row | 218 ms |
| **75 products, ids only** | **218 ms** ← same as one row |
| **75 products + their units and categories (~45 KB)** | **944 ms** |

So `/api/products` is **one query** and still takes ~1 second. The extra ~700 ms is **Postgres → app
transfer**: ~45 KB across a 230 ms link is bounded by round trips, not bandwidth.

That happens **before Next.js ever sees the data**, which rules out a whole category of fixes —
HTTP compression, response caching at the edge, gzip — none of them touch it.

There are only three levers on that number: **send less**, **move closer**, or **ask less often**.

---

## 🔴 Why Redis is the wrong tool here

**1. It does nothing for the slowest thing you do.** Saving a sale is ~1.6 s and it is *seven
sequential database round trips* — BEGIN, update stock, insert the sale, insert the line, read the
result, COMMIT. A cache cannot make a write faster. Redis would leave your single biggest complaint
exactly where it is.

**2. Your reads are already cached, on the client.** TanStack Query is configured with a 5-minute
`staleTime` and a 30-minute `gcTime`. Navigating away and back **already costs zero requests**.
Redis would duplicate a cache you have, one layer further away.

**3. Redis is itself a network hop.** From Pakistan to a managed Redis you would pay latency again —
unless it sits in the same region as the database, at which point you have proven the region is the
problem and could just fix that instead.

**4. The hot payload contains `stock`.** Products carry the stock figure, and stock changes on every
single sale. Caching it means either showing stale stock in the till, or invalidating on every write —
which is most of the complexity of a cache for almost none of the benefit. Stock is precisely the
data that must never be stale.

**5. One more service to pay for, monitor, and have fail** on a single-owner shop app.

> If you ever *do* want server-side caching, **Next.js `unstable_cache` with tag invalidation** is
> the better answer than Redis: no new service, no new bill, and it invalidates from the same code
> that already invalidates the client cache. Same stock caveat applies.

---

## What actually helps, in order

### 1. 🥇 Move the database to Mumbai — bigger than everything else here

It is the only change that fixes **both** costs at once, and the only one that helps **writes**:

| | Seoul now | Mumbai |
|---|---|---|
| Round trip | 230 ms | **~50 ms** |
| Saving a sale (7 trips) | ~1.6 s | **~0.35 s** |
| Catalog (~30 KB transfer) | ~1.0 s | **~0.25 s** |
| Sales list | 245 ms | **~100 ms** |

Everything else on this page is a rounding error next to this. Plan is ready in
`2026-08-19-move-database-to-mumbai-PLAN.md`; it needs you to create the project.

### 2. 🥈 Test on a production build, not `npm run dev`

`next dev` compiles each route **the first time you visit it**. That is why the first visit to a
screen takes seconds and the second is instant — and it does not exist in production at all. A fair
part of "changing pages takes 2–3 seconds" is this, not your app.

```bash
npm run build && npx next start
```

### 3. ✅ Done today — stop shipping dead fields

`/api/products` was sending `createdAt` and `updatedAt` for all 75 products. **Nothing in the UI reads
them.** Removed: **35,020 → 29,170 bytes**, 17% smaller.

Being straight: the wall-clock gain is inside the run-to-run noise. 17% fewer bytes does not reliably
remove a round trip. It is worth having, but it is not a fix.

### 4. If the catalog grows past a few hundred products

Split that payload: identity, price and units change rarely and could be cached hard; **stock**
changes constantly and is small on its own. Today, with 75 products, this is not worth the
complexity — but it is the right shape later, and it is what I would do before reaching for Redis.

---

## What will NOT help — so you don't spend money on it

| Idea | Why not |
|---|---|
| **Redis / Memcached** | See above — no help for writes, duplicates the client cache, adds a hop, and the hot data is stock |
| **Database indexes** | The database is doing no meaningful work. `SELECT 1` costs the same as a real query — the time is network, not computation |
| **A bigger Supabase instance** | Same reason. You are not CPU- or IO-bound |
| **HTTP/edge caching, gzip** | The expensive transfer is Postgres → app, before HTTP exists |
| **More Prisma tuning** | Already checked. `relationJoins` changed nothing; the remaining queries are one statement each |

---

## Where the time actually goes now

| Action | Time | What it is |
|---|---|---|
| Reports summary, settings | ~235 ms | 1 round trip — at the floor |
| Sales list | ~245 ms | 2 concurrent trips |
| Customers | ~630 ms | 3 trips |
| Catalog / till product list | ~1.0 s | 1 trip + ~30 KB transfer |
| **Saving a sale** | **~1.6 s** | **7 sequential trips inside a transaction** |

Every one of those numbers is `n × 230 ms`. **The 230 ms is Seoul.** That is the whole story, and it
is why the region move is not one option among several — it is the answer, and the rest is tidying.

**File:** `docs/responses/2026-08-19-what-else-can-speed-this-up.md`
