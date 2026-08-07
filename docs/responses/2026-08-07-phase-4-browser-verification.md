# Response — Phase 4 browser verification (bakery + beverages regression)

**Date:** 7 Aug 2026
**Task:** verify bakery works AND beverages didn't regress, in one pass, Phase 3.2 rigor.
**Outcome:** **all functional checks PASS. One real regression found — cosmetic, not fixed.**
DB restored to exact baseline. **Nothing committed. Nothing fixed.**

| | |
|---|---|
| Environment | `npm run dev` + Chrome DevTools, isolated browser context |
| Test login | `zz_test_p4@example.test` — throwaway, **deleted afterwards** |
| Owner account | **`i228767@nu.edu.pk` never modified** — see the note in §4 |
| Test data | all `ZZ_TEST_`-prefixed, **deleted** |
| Code changed during verification | **none** — `git status` identical to pre-test |

---

## 1. FINDING — beverages label regression (real, cosmetic, NOT fixed)

**The only regression found. Reporting before any fix, as instructed.**

Lifting `LineItemRow` into the shared component introduced unit-aware field labels for
bakery's eggs-by-the-cotton requirement. Those labels apply to **every** module, so beverages
changed too:

| Field | Before (committed `72fc56d`) | Now |
|---|---|---|
| Quantity label | `Quantity` | **`Quantity (bottles)`** |
| Price label | `Unit price` | **`Price per bottle`** |

Confirmed against the committed source, not inferred:

```
$ git show HEAD:components/beverages/LineItemRow.tsx | grep "Quantity\|Unit price"
107:  <Label htmlFor={`item-${index}-quantity`}>Quantity</Label>
126:  <Label htmlFor={`item-${index}-price`}>Unit price</Label>
```

**Severity: cosmetic.** Every beverage product carries `unit: "bottle"`, so the labels are
accurate — arguably an improvement, since "Price per bottle" is less ambiguous than "Unit
price". Nothing functional changed: values, validation, totals and the submitted payload are
all identical.

**But it is an unrequested change to the flagship screen**, and the brief said not to change
beverages' behaviour when generalizing. Three options, your call:

1. **Keep it** — labels are more precise on both modules.
2. **Bakery-only** — gate the unit suffix on `module.key !== "beverages"`. Inconsistent, but
   leaves beverages byte-identical.
3. **Suffix only for non-obvious units** — show it for `cotton` (where the count is genuinely
   ambiguous), suppress for `bottle`/`piece`. My preference if you want beverages untouched:
   it targets the actual problem rather than the module.

---

## 2. Part A — bakery works

### 2.1 The picker (items 1–9)

Live output from the rendered picker:

```
Biscuits    Premium | Simple
Buns        Buns
Cake Rusk   Premium | Simple
Eggs        Eggs
Russ        Large › Circle | Large › Rectangular Round
            Small › Circle | Small › Rectangular Round
```

| # | Check | Result |
|---|---|---|
| 1 | Groups render | **PASS** — Biscuits, Buns, Cake Rusk, Eggs, Russ |
| 2 | **Buns reads "Buns"**, not a blank row | **PASS** |
| 3 | Eggs reads "Eggs" | **PASS** |
| 4 | Both Biscuits variants distinct | **PASS** — "Premium" / "Simple" |
| 5 | Both Cake Rusk variants distinct | **PASS** |
| 6 | **All four Russ individually distinguishable** | **PASS** — size **and** shape on every row |
| 7 | Search `circle` | **PASS** — exactly the 2 Circle variants |
| 8 | Search `premium` | **PASS** — 2 rows, and the **group headings stay visible**, so they read as *Biscuits › Premium* and *Cake Rusk › Premium* rather than two identical "Premium" rows |
| 9 | **No "0% off" anywhere** | **PASS** — checked all 10 rows (bakery stores `discountPercent = 0`, so a loose check would have printed it on every one) |

### 2.2 Eggs by the cotton (items 10–13)

| # | Check | Actual |
|---|---|---|
| 10 | Quantity label | **`Quantity (cottons)`** |
| 10 | Price label | **`Price per cotton`** |
| 11 | Line summary, qty 3 @ 250 | **`3 cottons · Line total`** → **Rs. 750** |
| 12 | Singular at qty 1 | **`1 cotton · Line total`** |
| 13 | Buns qty 12 | **`12 pieces`**, label `Quantity (pieces)` |

### 2.3 Sale recorded and read back (items 14–16)

| # | Check | Result |
|---|---|---|
| 14 | 0-priced product | **PASS** — amber "set price" in picker, price auto-fills `0`, "This product has no price set yet." shown, field editable |
| 15 | Save 3-line sale | **PASS** — Rs. 1,530, toast, confirmation panel |
| 16 | Expanded row | **PASS** — see below |

Expanded row, verbatim:

```
ZZ_TEST_Bakery Shop  04/08/2026 · 3 items · Shop          Rs. 1,530
  Eggs                          3 cottons × Rs. 250          Rs. 750
  Buns                          12 pieces × Rs. 40           Rs. 480
  Russ Small Rectangular Round  Small · Rectangular Round ·
                                5 pieces × Rs. 60            Rs. 300
```

Russ shows **both** size and shape. Database confirms `saleDate 2026-08-03 19:00:00` UTC =
**Karachi midnight on 04/08** — Gotcha 4 holds on bakery too.

### 2.4 Bakery price snapshot (items 17–20)

Changed Eggs' catalog price `0 → 999` after the sale:

```json
{ "catalogBefore": 0, "catalogNow": 999,
  "saleLine_unitPrice": 250, "saleLine_lineTotal": 750, "saleTotal": 1530,
  "snapshotHeld": true }
```

UI agreed — still `3 cottons × Rs. 250`, never mentioned 999. **PASS.** Catalog restored to 0.

### 2.5 Module ownership (items 21–23) — both directions

| # | Request | Result |
|---|---|---|
| 21 | Bakery picker contents | **PASS** — only bakery groups; no Pepsi/Coke |
| 22 | Beverages product → bakery sale | **400** *"Pepsi 1.5L" is not a Bakery product, so it can't go on a bakery sale.* |
| 23 | Bakery product → beverages sale | **400** *"Eggs" is not a Beverages product, so it can't go on a beverages sale.* |

Friendly sentences, not FK errors, in both directions.

### 2.6 Bakery delete guard (items 40–44) — all three levels

| # | Level | Result |
|---|---|---|
| 40 | Eggs **sub-category** | **409** + `blockedBy: [{id: "prod_eggs", name: "Eggs", saleCount: 1}]` |
| 41 | **Bakery category** | **409**, naming all three sold products, with full structured payload |
| 42 | **"Deactivate these"** | **PASS** — see below |
| 43 | **Eggs product** itself | **200**, `deleted: "soft"`, `isActive: false`, row retained — **not** a 409 |
| 44 | History after soft delete | **PASS** — all three resolve by name, marked `(inactive)`, snapshots + total intact |

Item 42 measured before/after:

| Measure | Before | After |
|---|---|---|
| Inactive products | `[]` | `["Buns", "Eggs", "Russ Small Rectangular Round"]` |
| **Russ active** | 4 | **3** — the 3 unsold siblings survived |
| Bakery active | 10 | 7 |
| **Beverages active** | 52 | **52** — untouched |
| Total products | 62 | **62** — nothing deleted |

UI rendered the amber refusal with per-product sale counts drawn from the structured field,
and the destructive button was removed after refusal.

---

## 3. Part B — beverages did NOT regress

### 3.1 Cross-module cache — the flagged risk (item 30)

**PASS, decisively.** With deliberately distinct data — beverages **Rs. 1,200 / 1 item**,
bakery **Rs. 1,530 / 3 items** — I navigated client-side (not full reloads, which would reset
the cache and hide the bug) and sampled as tight as **80 ms** after each click.

12 samples across three rapid switches. Heading and totals **always agreed**:

```
/beverages -> Beverages  Rs. 1,200   (@80ms, 200ms, 500ms, 1200ms)
/bakery    -> Bakery     Rs. 1,530
/beverages -> Beverages  Rs. 1,200
/bakery    -> Bakery     Rs. 1,530
```

Bakery **never** showed Rs. 1,200; beverages **never** showed Rs. 1,530. During the transition
the incoming module rendered skeletons rather than the outgoing module's rows — which is what
module-scoped keys (`["sales", module.key, …]`) are supposed to produce.

*Note on method:* I first tried to dump the QueryClient cache keys via the React fiber tree and
could not reach the client instance. Rather than report that as verified-by-inspection, I
proved it behaviourally instead — a cross-module leak would necessarily have shown as a wrong
total under the wrong heading in at least one of the 12 samples.

### 3.2 The three Phase 3.2 fixes survived

| # | Fix | Result |
|---|---|---|
| 27 | Backwards date range keeps filters | **PASS** — filters survived, inline hint *"The start date is after the end date. Adjust either date — or swap them."*, no whole-page error, previous results retained, **"swap them" recovered** and Clear filters worked |
| 28 | Total bar doesn't cover sidebar logout | **PASS** — `logoutIsCovered: false`, bar starts at x=240 (sidebar edge) |
| — | Offline save recovers | **PASS** — recovered in **203 ms** with *"Can't reach the server. Check your connection."*, button re-enabled, no hang |

Backwards range also verified **on bakery** (item 33) — same behaviour.

### 3.3 Beverages end-to-end (items 24–26, 29)

| # | Check | Result |
|---|---|---|
| 24 | Accent still **blue** | **PASS** — Save button `bg-blue-600`, no amber |
| 25 | Picker unchanged | **PASS** — `1.5L › 30% off` style; full-price row sorts above its discount variants; only beverage groups |
| 26 | Record a sale end-to-end | **PASS** — Rs. 1,200 saved, toast, confirmation |
| 29 | Date label above its field | **PASS** |

---

## 4. Cleanup — DB restored to exact baseline

| Table | Baseline | After | Match |
|---|---|---|---|
| `User` | 1 | 1 (`i228767@nu.edu.pk`) | ✅ |
| `Customer` | 0 | 0 | ✅ |
| `BeverageSale` / items | 0 / 0 | 0 / 0 | ✅ |
| `BakerySale` / items | 0 / 0 | 0 / 0 | ✅ |
| `Product` | 62 | 62 | ✅ |
| `Product` active | 62 | **62** | ✅ |
| `Product` priced ≠ 0 | 0 | 0 | ✅ |
| `Category` / `SubCategory` | 2 / 11 | 2 / 11 | ✅ |
| `CustomerPayment` | 0 | 0 | ✅ |

Deleted, `ZZ_TEST_`-scoped only: 3 bakery items, 1 bakery sale, 1 beverage item, 1 beverage
sale, 1 customer, 1 throwaway user. **Reactivated all three products** deactivated during item
42, and restored Eggs' catalog price to 0. Verified **0 non-`ZZ_TEST_` rows** were in range
before deleting.

**One thing to flag honestly:** Chrome restarted mid-session and dropped my isolated context,
briefly landing me in your default browser session (signed in as Owner). I noticed on the next
read, immediately created a fresh isolated context, and signed back in as the throwaway
account. Nothing was written during that window — the only call made was a read of
`/api/customers`. Your owner account and session were not modified.

Dev server stopped. `git status` is byte-identical to before the pass — **no fixes applied**.

---

## 5. Verdict

**Bakery is functionally correct**, including every case that differs from beverages, and
**beverages did not functionally regress** — the risky cache leak did not materialise, and all
three Phase 3.2 fixes survived the lift.

The one open item is the **label change in §1**, which is cosmetic and arguably an improvement,
but is a change to beverages I did not ask permission for. Tell me which of the three options
you want and I'll apply it, then this is ready to commit.
