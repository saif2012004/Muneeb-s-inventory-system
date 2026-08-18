# Everything left to do

**Date:** 2026-08-18
**Scope:** the two things you asked for, then every other open item, then what is already done.

---

# 1. 🔴 The app is slow — measured, and the cause is not what the docs assumed

You are right, and it is worse than it looks: **almost the entire wait is one thing repeated.**

## What I measured, on your machine, warm

```
warm  SELECT 1        : 1046, 1093, 1090, 1088, 1119 ms
warm  Settings by id  : 1120, 1112, 1066 ms
5 counts in series    : 5389 ms          (= 5 × ~1.08s, exactly linear)
```

`SELECT 1` does no work at all. **Every database round trip costs ~1.08 seconds**, so a screen's
speed is simply *how many queries it makes* × 1.08s:

| Screen / action | Measured |
|---|---|
| `/api/settings` (1 query) | **1.1s** |
| `/api/milk/farmers?withBalances=true` | **2.9s** |
| `/api/customers` | **3.2s** |

## 🔴 The finding: the connection pooler is adding ~950ms per query

I benchmarked the two connection strings the project already has. Same database, same machine, same
trivial query:

| Connection | Median per query |
|---|---|
| **Pooled `:6543` (pgbouncer, transaction mode)** — what the app uses | **1,175 ms** |
| **Direct `:5432` (session mode)** — used today only for migrations | **230 ms** |
| Pooled `:6543` without `connection_limit=1` | 1,116 ms |

Three things follow, and the third is the important one:

1. **230ms is the real network cost** to Seoul from here. That is the floor.
2. **`connection_limit=1` is not the culprit** — removing it changed nothing.
3. **The transaction pooler is costing ~950ms on every single query.** Not the region, not the query
   count, not Next.js. The app is roughly **5× slower than the network alone requires.**

CLAUDE.md has said "~1.1s per round trip" for weeks and treated it as a fact of the
Washington↔Seoul split. The number is real but the *attribution* was wrong, and it shaped the whole
architecture — every "collapse these five queries into one statement" workaround exists because of
it.

## What I propose

**Step 1 — prove it end to end (safe, reversible, ~30 minutes).** Point local `DATABASE_URL` at the
session pooler and re-measure the same screens. If `/api/customers` drops from 3.2s to ~0.7s, we
have our answer with no guesswork.

**Step 2 — decide production deliberately.** This is the one real caveat: the transaction pooler
exists *for serverless*. On Vercel, many concurrent functions each holding a session-mode connection
can exhaust Postgres's connection limit. For a **single-owner app** that is a very different risk
from a public site — realistically one or two concurrent requests — but it is a decision to make on
purpose, not a setting to quietly flip. Supabase's Supavisor supports session mode on `:5432` and it
is a supported configuration.

**Step 3 — then, and only then, the region move (#14).** Moving the Vercel function to Seoul takes
the remaining 230ms down to ~20ms. Worth doing, but it is the *smaller* win, and it does nothing for
you locally — your dev server sits in Pakistan either way.

> **Order matters:** fixing the pooler is ~5×. The region is a further big cut on what remains, but
> only in production. Doing the region first would have "fixed" the symptom while leaving 950ms of
> pure overhead on every query forever.

**Step 4 — query counts, last.** Some routes still make more trips than they need. That work is real
but worth far less once a trip costs 230ms instead of 1,175ms — and some of the existing
one-big-SQL-statement workarounds could then be simplified back into readable Prisma calls.

---

# 2. 🧾 Farmer statement — print one farmer's record for a date range

**Where:** `/milk/balances`, replacing the current **Export** button, which today dumps *all*
farmers' balances as a CSV with no date range and no detail.

## The flow you asked for

1. **Choose the farmer**
2. **Choose start and end dates**
3. **Print** — a statement laid out to be handed to that farmer

## What the printout will contain

**Header:** shop details (from Settings), farmer name and phone, the date range, and when it was
printed.

**Deliveries — milk you bought from them**, sorted by date:

| Date | Morning | Evening | Total litres | Rate | Amount |
|---|---|---|---|---|---|
| 08/08/2026 | 100 L | 150 L | 250 L | 120 | Rs. 30,000 |

- **Morning and evening shown separately and as a collective total**, as you asked
- **Amount = total litres × rate**, per your instruction
- A skipped session prints `—`, never `0` — a missed morning is not a farmer who came empty-handed
- **Totals row:** total litres for the period, and total value

**Purchases — what they took from you**, sorted by date:

| Date | Item | Amount |
|---|---|---|
| 08/08/2026 | Cow food | Rs. 25,000 |
| 10/08/2026 | **Cash** | Rs. 5,000 |

- The item as recorded; **"Cash"** when money was handed over rather than goods
- **Totals row:** total purchases for the period

**The bottom line:** milk value − purchases = **net for this period**, in words the farmer can
check: *"You are owed Rs. X"* or *"You owe Rs. Y"*.

> ⚠️ **A period statement is not a running balance, and it must not pretend to be.** If the range
> starts partway through a farmer's history, the closing figure is *this period's* net, not what you
> owe them overall. The statement will say which it is, and show the all-time balance separately so
> the two can never be confused. This is the same trap that stopped a date filter being added to the
> ledger back in Phase 6.

## One question for you

**What paper?** The receipt printer is a narrow roll (32 characters per line, or 48 once you confirm
the 80mm printer). A farmer statement is a six-column table that could run to many rows.

- **A4 / normal printer** *(my recommendation)* — the table fits properly, it reads like a
  statement, and it is what a farmer would keep
- **Thermal roll** — same printer as the sale receipts, but each delivery would wrap over 2–3 lines
  and a long range gets very long

Tell me which and I will build it. If you want both, A4 first.

---

# 3. Everything else still open

## 🔴 Go-live blockers — yours, not code

| | Item |
|---|---|
| **#2** | **The one deliberate data reset.** You have test data mixed in now: two test sales (Rs. 100 and Rs. 30,400), and a second test farmer with a 1,200 L delivery and a Rs. 50,000 purchase. Done once, at handover, with the delete set confirmed first |
| **#2b** | **Your real shop details in Settings.** Receipts print `SET SHOP NAME IN SETTINGS` today — deliberately shouting, so an unconfigured receipt can never pass for a real one |
| **#3** | **Vercel Pro + Supabase Pro.** Hobby forbids commercial use; the free Supabase tier keeps **zero** backups — which is why `backup5.sql` had to be taken by hand |

## 🔨 Build work

| | Item | Size |
|---|---|---|
| **#11** | **PWA** — manifest, service worker, install prompt. `start_url` and `scope` must both be `"/"`; a wrong value **only breaks after install**, so a browser can never catch it | Medium |
| **#12** | **Date pickers on the milk screens.** Quick entry and the farmer profile still use the native date input, which shows **mm/dd/yyyy** while everything else prints DD/MM/YYYY. `/sales` was fixed; the same component swaps in | Small |
| **#14** | **Region co-location** — move the Vercel function to Seoul. See item 1: do this *after* the pooler | Small, production-only |
| **#15** | **Supabase Data API surface** — whether to disable it. Not a leak (RLS blocks it), but the endpoint exists. Your call | Decision |

## 📱 Testing

| | Item |
|---|---|
| **#13** | **A real phone.** Not a resized window — emulation gives you geometry, not the on-screen keyboard, touch accuracy, or real latency. Quick entry especially: densest screen, used twice a day |

## Also worth doing before handover

- **Price the 47 new beverage products.** They were created at Rs. 0 to hold your pet matrix. Price
  what you stock, deactivate the rest.
- **Walk the shelf and set real stock.** Every product except milk sits at the placeholder **100**.
- **Check the pet counts** against your real cases — a wrong factor is the one value that silently
  drains a stock pool.

---

# 4. What is already done

So the list above is not mistaken for the whole picture.

**The unified sale rework, complete** — Migrations A, C, D, E, F and B; stages S1–S9. One sale table,
one till, one receipt, one place money is read from. The per-module screens, routes and tables are
gone.

**Features shipped:** multi-unit products (#19) · cooling charge (#17) · billing-time price override
(#18) · per-product sales reporting (#20) · sale edit UI (#8) · unified receipt · stock with delta
reconciliation · the delivery-to-stock bridge · customer receivables · farmer balances and ledger ·
reports with CSV exports · settings.

**Fixed today:** the save-sale validation message that pointed at nothing (`53467ba`), three silent
payload bugs that dropped `chilled`, `unitName`, `coolingCharge` and `units`, a catalog delete guard
that 500'd on till-only products, and two labels pointing at ids that did not exist.

---

## What I would do next, in order

1. **Prove the pooler fix locally** — biggest win available, ~30 minutes, fully reversible
2. **Build the farmer statement** once you have picked the paper
3. **#12 date pickers** — small and annoying
4. **#11 PWA**
5. Then go-live: your data, your details, the Pro upgrades, the region move

**File:** `docs/responses/2026-08-18-remaining-work.md`
