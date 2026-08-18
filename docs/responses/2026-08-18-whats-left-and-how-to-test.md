# What's left, and how to test the app yourself

**Date:** 2026-08-18
**Server:** running at **http://localhost:3000** — one instance on port 3000, current code, with
Migration B applied.

---

## Short answer: no, deployment is not all that's left

Two pieces of real code work remain, plus one testing pass. Everything else is your decisions or
go-live actions. I'd rather say that plainly than call it finished.

### 🔨 Actual build work — Phase 8 polish

| | Item | What it is |
|---|---|---|
| **#11** | **PWA** — manifest, service worker, install prompt | What lets you add the app to your home screen and have it open like an app rather than a browser tab. Not written yet. **One trap already documented:** `start_url` and `scope` must BOTH be `"/"`, and a wrong value **only breaks after install** — it cannot be seen in a browser, which is how this kind of bug survives |
| **#12** | **Date pickers on the milk screens** | Quick entry and the farmer profile still use the native `<input type="date">`, which renders **mm/dd/yyyy** on this machine while every date the app prints is DD/MM/YYYY. A native input takes the *device's* locale — no formatter of ours can change it. `/sales` was fixed by swapping in `DateRangeFilter`; the milk screens need the same swap. Small job |

### 📱 Testing

| | Item | Why it can't be skipped |
|---|---|---|
| **#13** | **A pass on a real phone** | Not a resized desktop window. Emulation is geometry — it does not reproduce the on-screen keyboard, touch accuracy, real network latency, or actual paint performance. **Quick entry especially**: it is the densest screen and the one you would use twice a day |

### 🔴 Your decisions and go-live actions — not code

| | Item |
|---|---|
| **#2 · #2b** | The one deliberate data reset, and your real shop details in Settings. Receipts currently print `SET SHOP NAME IN SETTINGS` — deliberately shouting, so an unconfigured receipt can never be mistaken for a real one |
| **#3** | Vercel Pro + Supabase Pro. Hobby forbids commercial use, and the free Supabase tier keeps **zero** backups — which is exactly why `backup5.sql` had to be taken by hand today |
| **#14** | Move the function to Seoul, beside the database. It runs in Washington DC today: ~11,000 km and ~1.1s on every single query, which is the entire performance model of the app |
| **#15** | Whether to disable the Supabase Data API surface. Not a leak — RLS already blocks it — but the endpoint exists |

**Also closed today:** checklist **#16** and **#20**. Both were genuinely done and the checkboxes had
simply never been ticked, which left the checklist contradicting its own text.

---

## What to poke at while you test

I verified all of this myself, but these are the judgement calls that are yours, not mine.

### The till — `/sales/new`

- Pick **Eggs**, then open **"Sold as"**. Choosing dozen / tray / peti should rewrite the price AND
  the field labels (`Quantity (peti)`, `Price per peti`).
- Try **1 peti**. It should be **refused**: *"100 in stock but this sale needs 360."* Stated in eggs
  on purpose — that is the number you can check against your shelf, which "1 peti" is not.
- Ring a normal sale and check the total as you type.

### The sales list — `/sales`

- The **Shop** filter. A bill holding both Pepsi and milk should appear under **both** Beverages and
  Milk — it genuinely is both, and hiding it from either would understate what that shop sold.
- Expand a row; edit one; delete one and confirm the stock comes back.

### The catalog — `/catalog`

- The **selling-units editor** on a product, and the `pet = 12 bottles` line under each beverage.
- ⚠️ **47 new beverage products sit at price 0.** Check that the ones you actually stock are there,
  and that **the pet counts match your real cases** — that number came from you, and it is the one
  value that would silently drain a stock pool if it were wrong.

### Reports — `/reports`

- The per-product table at the bottom: units sold and revenue per product, milk on its own line.
- The figures should read: bakery **5,000**, milk **6,000 / 50 L**, combined **11,000**.

### A receipt

Open a sale → **Print receipt**. Check the arithmetic **multiplies out** — the receipt prints paise
(`3 × 275.50`) while the screen rounds (`3 × Rs. 276`), deliberately, because a receipt is the one
document a customer checks with a calculator standing in front of you.

---

## Two things that look wrong and are not

- **Stock is 100 on nearly every product.** That is a placeholder, not a count. Milk is the exception
  (it is derived from deliveries and sales). The real numbers are a shelf-walk at handover — your
  task, not a figure for us to invent.
- **The shop name, phone and address shout placeholders on every receipt.** By design, until you set
  them in Settings. A friendly-looking placeholder would print a receipt that looks finished and is
  wrong, and the failure mode we are buying our way out of is a customer walking away holding one.

---

## If the server stops

```bash
npm run dev
```

If it ever starts on **3001** instead of 3000, stop everything first and delete `.next` — two dev
servers sharing one build directory will 404 every client chunk and the page will look broken while
the app is fine. There is a PowerShell one-liner for killing the listeners in CLAUDE.md under
"Local development notes".

**File:** `docs/responses/2026-08-18-whats-left-and-how-to-test.md`
