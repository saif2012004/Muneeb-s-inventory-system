# Both done: the app is ~5× faster, and the farmer statement ships

**Date:** 2026-08-19
**Commits:** `8c2bbdc` (speed) · `e0017fb` (statement)

---

## First, two corrections to what you said — both matter

### "the database url in the .env is already the session pooler"

It wasn't. Both URLs point at `pooler.supabase.com`, which is why it looks that way — but **the port
decides the mode**:

```
DATABASE_URL  …pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
                                  ^^^^ TRANSACTION pooler  ← the app was using this
DIRECT_URL    …pooler.supabase.com:5432/postgres
                                  ^^^^ SESSION pooler      ← migrations only
```

That port was the entire problem.

### "the region is ap-northeast-2. is it the nearest one to my location"

**No.** `ap-northeast-2` is **Seoul** — about 5,000 km from Pakistan. Supabase also offers
**`ap-south-1` (Mumbai)**, roughly 1,300 km from Lahore. Your database is in one of the *furthest*
Asian regions from you rather than the closest.

That is worth fixing later, but it is now the **smaller** half of the problem — see below.

---

# 1. ⚡ Speed — fixed, and measured

## What was wrong

Every database round trip cost **~1.08 seconds**, and a screen is just *query count* × that. A
`SELECT 1` — a query that does no work at all — took 1.1s.

I benchmarked both connection strings. Same database, same machine, same trivial query, six samples
each:

| Connection | Median per query |
|---|---|
| `:6543` transaction pooler + `connection_limit=1` | **1,175 ms** |
| `:6543` transaction pooler, no connection limit | 1,116 ms |
| **`:5432` session pooler** | **230 ms** |

**The transaction pooler was adding ~950 ms to every single query.** `connection_limit=1` was never
the culprit — removing it changed nothing. 230 ms is the real network cost of Pakistan → Seoul.

## What I changed

`DATABASE_URL` now points at the session pooler on `:5432`, without `pgbouncer=true` (that flag
disables prepared statements, which session mode does not need) and with `connection_limit=5`.

**This is safe because you told me only one person uses the app at a time.** The transaction pooler
exists so that many concurrent serverless functions can share few Postgres connections — concurrency
this product does not have. On a multi-user app the trade would be the wrong way round.

## The result, same screens, before → after

| | Before | After |
|---|---|---|
| `/api/settings` (1 query) | 1,104–1,158 ms | **231–234 ms** |
| `/api/customers` | 3,209–3,318 ms | **612 ms** |
| `/api/milk/farmers` | 2,773–3,042 ms | **620 ms** |

**Roughly 5× faster across the board.** Writes verified too: a sale created, stock 100 → 88, deleted,
stock restored — transactions behave normally in session mode.

## 🔴 Two things you need to know

**1. Production still needs this.** I changed your local `.env`. The Vercel `DATABASE_URL`
environment variable still points at `:6543` — change it in the Vercel dashboard before you deploy,
or production keeps the old speed. Your old `.env` is saved as `.env.backup-20260819` if you ever
want it back.

**2. Saving a sale is still ~2.9s, and I know exactly why.** I logged every statement: **one sale is
12 round trips**. Four of them are a single product lookup — Prisma issues a separate query per
relation level (`subCategory` → `category` → `units`). Prisma 6 can collapse those into one SQL JOIN
(`relationJoins`), which would cut a save to roughly 8 trips, ~1.8s. **I did not stack that change on
top of this one** — one measured change at a time, so if something misbehaves we know which one did
it. Say the word and it is a short job.

## The region, in proper order

Now that the pooler is fixed, the remaining 230 ms **is** the distance to Seoul. Moving the database
to **Mumbai** would take it to roughly 40–60 ms, and unlike the Vercel function region it would speed
up **your local development too**.

⚠️ **Supabase cannot move a project between regions in place.** It means creating a new project in
`ap-south-1` and migrating into it — new project ref, new connection strings, new keys. A gated
operation with a verified backup, like Migration B was. Worth doing at go-live, not mid-testing.

---

# 2. 🧾 Farmer statement — shipped

On **`/milk/balances`**, the old **Export** button is now **Farmer statement**.

**The flow:** choose the farmer → choose a date range (or leave both blank for their whole history) →
**Download**. It saves as a `.csv` that opens straight in Excel — no printer involved, exactly as you
asked.

**Here is a real one, downloaded through the app:**

```
Farmer statement
Farmer,Saif
Phone,0309999150
Status,Active
Period,All time
Generated,19/08/2026

Milk delivered
Date,Morning (L),Evening (L),Total Litres,Rate Per Litre,Amount
08/08/2026,100,150,250,120,30000
Total,,,250,,30000

Purchases
Date,Item,Amount
08/08/2026,biscuits,25000
Total,,25000

Summary
Milk value (this period),30000
Purchases (this period),25000
Net for this period,5000
Direction,You owe the farmer

All-time balance (not just this period),5000
All-time direction,You owe the farmer
```

Everything you specified is there: deliveries and purchases **sorted by date**, morning and evening
**separately and as the collective total**, the rate, and **rate × litres** as the amount. Purchases
show the item, with **"Cash"** where money was handed over instead of goods.

### Three decisions inside it worth knowing

**A period statement is not a running balance — so it shows both.** If you pick a range that starts
partway through a farmer's history, the closing figure is *that period's* net, not what you owe
overall. Those can differ by any amount, and a farmer holding one number has no way to tell which it
is. So the summary carries the period net **and** the all-time balance, each labelled. The all-time
figure is the same one the balance sheet shows, so the spreadsheet can never contradict the screen it
came from.

**"Cash" is matched on whole words.** `Cash`, `cash 5000` and `Cash for eid` all print as Cash;
**`cashew nuts` and `Cashews` stay items.** Your own wording is otherwise preserved.

**A skipped session prints blank, not 0.** A farmer who missed the morning is not a farmer who turned
up with nothing — and on a document he may be paid from, that difference matters.

### Verified

Downloaded through the real route as `statement_Saif_2026-08-19.csv`: 250 L at 120 = **30,000**, less
**25,000** purchases = **5,000 net**, matching the balance sheet exactly. A range that excludes
everything correctly reports zero for the period while still showing the 5,000 all-time.

The printed date range steps back 1 ms from an exclusive end boundary — checked across four ranges,
because the naive version prints **"01/01/2026 to 01/01/2027"** for a single year, claiming to cover a
day it does not include.

**The sample file is sitting in your Downloads folder** if you want to open it in Excel.

---

## What is left

Unchanged from the previous list, minus the speed item:

| | |
|---|---|
| 🔴 **#2 · #2b · #3** | Data reset · your real shop details · Vercel + Supabase Pro |
| **#11** | PWA — manifest, service worker, install prompt |
| **#12** | Date pickers on the milk quick-entry and farmer screens |
| **#13** | A pass on a real phone |
| **#14** | Move the database to Mumbai, then match the function region |
| **#15** | Whether to disable the Supabase Data API |
| — | Price the 47 new products, walk the shelf for real stock |
| — | *Optional:* the `relationJoins` change to take a save from ~2.9s to ~1.8s |

**File:** `docs/responses/2026-08-19-speed-fix-and-farmer-statement.md`
