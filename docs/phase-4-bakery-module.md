# Phase 4 — Bakery module

**Status:** written, type-checked, lint-clean. **NOT verified in a browser. NOT committed.**
**Scope:** bakery API + UI, built by generalising the Phase 3 components rather than forking
them. No migration run (tables already existed).

> Per the brief: this is the code and the test list. **I am not claiming it works.** Phase 3.2
> built green while carrying three real bugs, one of which trapped the owner with no way to
> recover. Browser verification is the separate next step.

---

## 1. Pre-flight

### 1.1 Supabase MCP — columns confirmed (read-only)

`BakerySale` and `BakerySaleItem` are **column-for-column identical** to their beverage
counterparts — same names, types, precision, nullability and defaults:

| `BakerySale` | `BakerySaleItem` |
|---|---|
| `id` text | `id` text |
| `customerId` text | `saleId` text |
| `saleDate` timestamp, default `CURRENT_TIMESTAMP` | `productId` text |
| `totalAmount` numeric(10,2) | `quantity` integer |
| `notes` text NULL | `unitPrice` numeric(10,2) |
| `createdAt` timestamp, default `CURRENT_TIMESTAMP` | `lineTotal` numeric(10,2) |

That identity is the whole justification for sharing the components — it is a fact about the
schema, not an assumption.

### 1.2 The bakery catalog, as it actually is

Queried the 10 seeded bakery products. Two findings changed the design:

| Sub-category | Products | Distinguished by |
|---|---|---|
| Biscuits | 2 | `qualityTier` only (premium / simple) |
| Buns | 1 | **nothing** |
| Cake Rusk | 2 | `qualityTier` only |
| Eggs | 1 | **nothing** — but `unit: "cotton"` |
| Russ | 4 | `size` **and** `shape` |

1. **`discountPercent` is `0`, not `null`,** on every bakery product. The existing falsy check
   handles it — but it means a truthy test is required, or every row would read "0% off".
2. **The Phase 3 label logic would have broken bakery.** It composed labels from size +
   discount only, which is fine for beverages but makes bakery products **indistinguishable**:
   `Biscuits Premium` and `Biscuits Simple` would both render as "Biscuits"; all four Russ
   variants would collapse to "Large"/"Small". Two identical rows in a picker is a way to
   record the wrong sale.

### 1.3 Context7

Pulled TanStack Query docs for the parameterised **query key factory** pattern before writing
`lib/hooks/use-sales.ts` — confirmed the canonical shape (a factory object with `as const`
tuples, dependencies passed in). Query keys are now scoped by module, which matters: without
the module segment, opening `/bakery` would briefly show beverage rows from cache.

---

## 2. What was REUSED, not rewritten

Per the brief, nothing below was re-derived:

| Reused | How |
|---|---|
| `reconcileSaleLines()` | Imported unchanged. Bakery's PATCH calls the same function — the price-snapshot rule has exactly one implementation. Quantity is still not a re-price trigger. |
| `SALE_DETAIL_SELECT` | Shared. Written generically because `BakerySale` has the same relation names. |
| `loadSaleProducts()` | Shared, parameterised by `categoryId` + `moduleLabel`. This is what makes "a Beverages product on a bakery sale is a 400" work, mirrored, with no new code. |
| `snapshotUnitPrice`, `computeLineTotal`, `sumLineTotals`, `checkTotalFits` | Shared. |
| `serialize()` / money helpers | Shared. |
| TanStack Query `networkMode: "always"` + 15s timeout | **Untouched**, as instructed. |
| The eight sale components | **Lifted**, not copied — see §3. |

### New shared extractions

While generalising, three more things moved into `lib/sales.ts` so the two API routes couldn't
drift on them either: **`SALE_LIST_SELECT`**, **`SALE_LIST_ORDER`** (the newest-first ordering
with the stable `createdAt` tiebreak) and **`buildSaleDateWindow()`** (the Karachi date window,
including the backwards-range rejection). The beverages route now imports them too.

---

## 3. Components lifted to `/components/sales/`

The brief's preferred option. All eight moved with `git mv` (history preserved) and are now
parameterised by a `SaleModule`:

```
components/beverages/*  ->  components/sales/*
    NewSaleForm  LineItemRow  ProductPicker  CustomerCombobox
    SaleDatePicker  SalesList  SaleLineItems  DeleteSaleDialog
```

`lib/sale-modules.ts` holds what actually differs — and it is a short list:

```ts
{ key, label, accent, apiBase, listRoute, newSaleRoute,
  listDescription, formDescription, emptyTitle }
```

Both pages are now four lines: `<SalesList module={BAKERY_MODULE} />`. Adding Milk sales later
should mean adding a config row, not another copy of the form.

**Superseded and deleted:** `lib/beverage-catalog.ts`, `lib/hooks/use-beverage-sales.ts`.
**Renamed:** `lib/validations/beverage-sale-form.ts` → `sale-form.ts` (it was already generic).

---

## 4. Where bakery genuinely differs

### 4.1 Attribute-less products degrade to a single named choice

`lib/sale-catalog.ts` composes the label from **every** attribute a product carries — size,
`qualityTier`, `shape`, then discount — and omits the ones it doesn't. No empty groupings, no
dangling separators.

A row renders `detail` when it has one, and falls back to the **brand** when it doesn't, so
Buns and Eggs name themselves instead of appearing as blank rows under their own heading.

### 4.2 Eggs are counted in cottons

`unit` lives on the product, so the form labels itself once a product is chosen:

| | |
|---|---|
| Quantity field | **"Quantity (cottons)"** — or "Quantity (pieces)", or plain "Quantity" |
| Price field | **"Price per cotton"** |
| Line summary | **"3 cottons · Line total"** |
| Expanded sale row | **"3 cottons × Rs. 250"** |

Singular is handled: 1 → "1 cotton".

### 4.3 All four Russ variants are distinguishable

Size **and** shape both appear, in the picker and in the expanded row. `SALE_DETAIL_SELECT`
gained `qualityTier` and `shape` for exactly this reason — without them an expanded bakery line
could not say which product it was.

### 4.4 Price 0 behaviour is kept

Bakery products are seeded at 0 like beverages, so the editable unit price, the amber **"set
price"** hint in the picker, and the "This product has no price set yet." note all carry over
untouched.

### 4.5 Verified in isolation (not a browser test)

Ran the label logic against the exact seeded bakery rows. **All checks passed:**

```
Biscuits › Premium            Biscuits › Simple          (distinguishable ✓)
Russ › Large › Circle         Russ › Large › Rectangular Round
Russ › Small › Circle         Russ › Small › Rectangular Round   (4 distinct ✓)
Buns -> "Buns"                Eggs -> "Eggs"             (degrade ✓)
no "0% off" leaked anywhere                              ✓
Quantity (cottons) · 3 cottons · 1 cotton · 12 pieces    ✓
```

**Beverages regression, same run:** `Pepsi › 1.5L`, `Pepsi › 1.5L › 30% off`, `Big Apple`,
`Juice › 0.5L`, full-price row still sorts above its discount variants — all unchanged.

---

## 5. Files

### New

| File | What |
|---|---|
| `app/api/bakery/sales/route.ts` | GET list (paged, Karachi-filtered), POST create |
| `app/api/bakery/sales/[id]/route.ts` | GET one, PATCH via `reconcileSaleLines`, hard DELETE |
| `app/(dashboard)/bakery/page.tsx` | `/bakery` |
| `app/(dashboard)/bakery/new-sale/page.tsx` | `/bakery/new-sale` |
| `lib/sale-modules.ts` | Module config + accent class maps |
| `lib/sale-catalog.ts` | Generalised labelling + unit helpers |
| `lib/hooks/use-sales.ts` | Module-parameterised query hooks |

### Modified

| File | Change |
|---|---|
| `lib/sales.ts` | Added `SALE_LIST_SELECT`, `SALE_LIST_ORDER`, `buildSaleDateWindow`, `toSaleListRow`; `SALE_DETAIL_SELECT` gained `qualityTier` + `shape` |
| `app/api/beverages/sales/route.ts` | Uses the shared list helpers |
| `app/(dashboard)/beverages/*` | Render the shared components with `BEVERAGES_MODULE` |
| `components/sales/*` (×8) | Parameterised by module |

**No migration. No schema change. No change to the global Query settings.**

---

## 6. Manual test list

Sign in first. `npm run dev`. **Bakery accent is amber throughout — if anything is blue on a
bakery screen, that's a bug.**

### 6.1 Bakery-specific — the point of this phase

| # | Step | Expect |
|---|---|---|
| 1 | `/bakery/new-sale`, open the product picker | Groups: Biscuits, Buns, Cake Rusk, Eggs, Russ |
| 2 | Look at **Buns** | **One row reading "Buns"** — not a heading above a blank row |
| 3 | Look at **Eggs** | One row reading "Eggs" |
| 4 | Look at **Biscuits** | Two rows: **"Premium"** and **"Simple"** — visibly different |
| 5 | Look at **Cake Rusk** | Two rows: "Premium" / "Simple" |
| 6 | Look at **Russ** | **Four distinct rows**: Large › Circle, Large › Rectangular Round, Small › Circle, Small › Rectangular Round |
| 7 | Search `circle` | Only the two Circle Russ variants |
| 8 | Search `premium` | Biscuits Premium **and** Cake Rusk Premium |
| 9 | Check every row | **No row says "0% off"** (bakery stores `discountPercent = 0`) |
| 10 | Select **Eggs** | Quantity label becomes **"Quantity (cottons)"**; price label **"Price per cotton"** |
| 11 | Eggs, qty `3`, price `250` | Line summary reads **"3 cottons · Line total"**, total **Rs. 750** |
| 12 | Change qty to `1` | Reads **"1 cotton"** — singular |
| 13 | Select **Buns**, qty `12` | Reads **"12 pieces"** |
| 14 | Select a 0-priced product | Amber **"set price"** in the picker, and "This product has no price set yet." under the field |
| 15 | Save a sale with Eggs + a Russ variant | Success; confirmation shows the total |
| 16 | `/bakery`, expand that sale | Eggs line reads **"3 cottons × Rs. 250"**; the Russ line names **both** size and shape |

### 6.2 Bakery price snapshot (Gotcha 5)

| # | Step | Expect |
|---|---|---|
| 17 | Note a saved bakery line's unit price | e.g. Rs. 250 |
| 18 | In `/catalog`, change that product's price to something obvious (999) | Saved |
| 19 | Re-expand the bakery sale | **Unchanged** — still Rs. 250, same line total, same sale total |
| 20 | Reset the catalog price | — |

### 6.3 Module ownership

| # | Step | Expect |
|---|---|---|
| 21 | Open the picker on `/bakery/new-sale` | **Only bakery products** — no Pepsi, no Coke |
| 22 | POST a bakery sale with a Beverages product id (curl/devtools) | **400**, *"…is not a Bakery product, so it can't go on a bakery sale."* — a sentence, **not** an FK error |
| 23 | Same in reverse: a bakery product on `/api/beverages/sales` | 400, mirrored wording |

### 6.4 Beverages regression — the lift must not have broken it

| # | Step | Expect |
|---|---|---|
| 24 | `/beverages` | Loads, **blue** accent, existing behaviour |
| 25 | `/beverages/new-sale`, open the picker | Still `Pepsi › 1.5L › 30% off` style; full-price row above its discount variants |
| 26 | Record a beverage sale | Works as before |
| 27 | Backwards date range on `/beverages` (From later than To) | Filters **survive**, inline hint + "swap them", no whole-page error (the Phase 3.2 fix) |
| 28 | Sidebar Log out on `/beverages/new-sale` at desktop width | Clickable, not covered by the total bar |
| 29 | Date label on the form | **Above** its field, aligned with Customer |
| 30 | Switch `/beverages` → `/bakery` | Bakery shows **bakery** sales only — no beverage rows flashing from cache |

### 6.5 Shared behaviour on the bakery screens

| # | Step | Expect |
|---|---|---|
| 31 | `/bakery` with no sales | Empty state, amber accent, "New sale" |
| 32 | Filters: date range + customer | Same behaviour as beverages |
| 33 | Backwards range on `/bakery` | Inline hint, filters survive |
| 34 | Pagination with >10 bakery sales | "Page 1 of 2", Prev/Next enable correctly |
| 35 | Delete a bakery sale | Confirm dialog, then removed |
| 36 | Sign out in another tab, then save | "Your session expired…" then redirect — **not** a `res.json()` crash |
| 37 | Offline, then save | Recovers with "Can't reach the server." — does **not** hang on "Saving…" |
| 38 | 360px width | No horizontal scroll; total bar clears the bottom nav |
| 39 | Reduced motion | Total jumps rather than springs |

### 6.6 Delete guard for bakery (all three levels)

Needs a bakery sale to exist first.

| # | Step | Expect |
|---|---|---|
| 40 | `/catalog` → delete the **Eggs** sub-category (its product is on a sale) | **409**, amber refusal naming Eggs, structured `blockedBy: [{ id, name, saleCount }]` |
| 41 | Delete the whole **Bakery** category | **409**, naming every blocking bakery product |
| 42 | Use **"Deactivate these"** | PATCHes **by id**; only the named products deactivate, siblings untouched |
| 43 | Delete the **Eggs product** itself | **200**, `deleted: "soft"`, `isActive` → false — **not** a 409 |
| 44 | Re-expand the bakery sale | Eggs still resolves by name, marked **(inactive)**, snapshot price intact |

---

## 7. Verification so far

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx next lint` (whole project) | ✔ No ESLint warnings or errors |
| Label logic vs. the real seeded bakery rows | **all passed** (§4.5) |
| Beverages label regression | **all passed** (§4.5) |
| Supabase column check (read-only) | `BakerySale`/`BakerySaleItem` identical to beverages |
| Migration run? | **No** |
| Browser verified? | **NO — this is the next step** |
| Committed? | **No** |

**What the above does NOT prove:** that the screens behave. Types and labels are unit-level
facts; §6 is what establishes the module actually works, and §6.4 in particular is what proves
the component lift didn't quietly break beverages.
