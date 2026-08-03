# Phase 2.3 — Seed Run (production write)

**Status:** Seed executed and verified. Phase 2 functionally complete.
**Date:** 2026-08-03
**Commit:** `018d9fe` — `docs: correct seed upsert count comment`
**Production write:** yes — executed against the live Supabase database after explicit approval.

---

## 1. Execution

```
npm run seed  →  prisma db seed  →  tsx prisma/seed.ts

Seed complete: 2 categories, 11 sub-categories, 62 products.
```

Ran against a clean database: catalog tables were confirmed at **0 rows** immediately before
execution, so this was a fresh seed, not a re-run on top of existing data.

### Deprecation notice (expected, not a problem)

`prisma db seed` warned that `package.json#prisma` is deprecated and moves to
`prisma.config.ts` in **Prisma 7**. The project is pinned to **v6 deliberately** (see the
"Prisma version conventions" guardrail in CLAUDE.md), where `package.json#prisma` is the
correct location. This is a v7-migration item, not a defect.

---

## 2. Row counts — exact match to plan

| Sub-category | Created | Plan | ✓ |
|---|---:|---:|:-:|
| Pepsi | 16 | 16 | ✓ |
| Coke Cola | 16 | 16 | ✓ |
| Gourmet | 16 | 16 | ✓ |
| Juice | 2 | 2 | ✓ |
| Big Apple | 1 | 1 | ✓ |
| Big Lychee | 1 | 1 | ✓ |
| Cake Rusk | 2 | 2 | ✓ |
| Buns | 1 | 1 | ✓ |
| Biscuits | 2 | 2 | ✓ |
| Russ | 4 | 4 | ✓ |
| Eggs | 1 | 1 | ✓ |
| **Total** | **62** | **62** | ✓ |

**Categories: 2** (Beverages, Bakery) · **Sub-categories: 11** · **Products: 62** · 75 rows total.

### Field invariants

| Check | Result |
|---|---|
| `price = 0` | **62 / 62** (non-zero: 0) |
| `isActive = true` | **62 / 62** (inactive: 0) |
| Milk categories | **0** — correct, milk is not a catalog category |

---

## 3. Supabase MCP verification

Verified independently of the seed script's own output:

| Check | Result |
|---|---|
| Category / SubCategory / Product counts | 2 / 11 / 62 ✓ |
| RLS enabled on seeded tables | ✅ all 15 tables |
| `_prisma_migrations` | **2** — unchanged; seeding is not a migration ✓ |
| Security advisors | 15 × `rls_enabled_no_policy` at **INFO** |
| `rls_disabled_in_public` (the one to watch for) | **none** |

The INFO-level advisors are the documented healthy steady state in CLAUDE.md, not a
regression.

---

## 4. Comment fix — committed

`018d9fe` — `docs: correct seed upsert count comment`. One line, pushed.

```diff
- * Not wrapped in a transaction: 76 sequential upserts would risk blowing the
+ * Not wrapped in a transaction: 75 sequential upserts would risk blowing the
```

The 76 was left over from before the empty Milk Shop category was dropped.

---

## 5. Browser check of the seeded catalog

### Renders correctly

- Both categories present, 11 sub-categories with the correct counts
  (Big Apple 1, Big Lychee 1, Coke Cola 16, Gourmet 16, Juice 2, Pepsi 16, Biscuits 2,
  Buns 1, Cake Rusk 2, Eggs 1, Russ 4)
- All 62 products listed
- Sizes display correctly: stored `half_litre` renders as **0.5L**, `1.5L` as **1.5L**
- Units render as "per bottle" / "per piece" / "per cotton"
- No Milk category in the catalog. ("Milk Shop" appears once in `main`, but only inside the
  page's own copy: *"Milk is measured by the litre and lives in the Milk Shop, not here."*)

### Zero prices render as "Set price", not "Rs. 0"

All 62 price cells show a **"Set price"** affordance. This is the deliberate 2.2 behaviour —
a clickable prompt is more useful than a misleading `Rs. 0` — but it differs from the literal
"Rs. 0" expectation in the request. One-line change in `InlinePriceEditor.tsx` if the literal
form is preferred.

---

## 6. 🐞 Bug found: module accent classes were being stripped from the build

### Symptom

Bakery rendered amber correctly, but **Beverages rendered near-black instead of blue**. The
`text-blue-600` class *was* present on the element, yet the computed colour was
`rgb(9, 9, 11)` — the default foreground.

### Diagnosis

Walking `document.styleSheets` showed the rule simply did not exist:

```
.text-blue-600   → NOT FOUND in any stylesheet
.text-amber-600  → found
```

`tailwind.config.ts` `content` globs were:

```
./pages/**  ./components/**  ./app/**  ./src/**
```

**`./lib` was missing.** The entire `ACCENTS` map — every module accent class in the design
system — lives in `lib/nav.ts`. Tailwind scans source *text*, so it never saw those class
names and dropped them from the generated CSS. `text-amber-600` survived purely by
coincidence: `components/catalog/DeleteDialog.tsx` happens to use it as a literal, and that
file *is* scanned.

### Scope — wider than the catalog

This is a **Phase 1 bug**, not a 2.2 one. `lib/nav.ts` has been the accent source since the
app shell was built, so the Sidebar and BottomNav active-item accents have been silently
degraded since then too. It only became visible now because the seed put real Beverages and
Bakery categories on screen.

### Fix

Added `"./lib/**/*.{ts,tsx}"` to `content`, with a comment explaining why it must stay.

### Verified after the fix

| Category | Text | Tint | Border |
|---|---|---|---|
| Beverages | `rgb(37,99,235)` blue-600 ✓ | `rgb(239,246,255)` blue-50 ✓ | `rgb(219,234,254)` blue-100 ✓ |
| Bakery | `rgb(217,119,6)` amber-600 ✓ | `rgb(255,251,235)` amber-50 ✓ | `rgb(254,243,199)` amber-100 ✓ |

The sidebar's active item also regained its `zinc-100` background.

---

## 7. State

| | |
|---|---|
| Seed | ✅ run, verified, exact match to plan |
| RLS / migrations | ✅ unchanged (RLS on, `_prisma_migrations` still 2) |
| Comment fix | ✅ committed and pushed (`018d9fe`) |
| Catalog renders | ✅ confirmed in browser |
| Accents | ✅ correct **after** the Tailwind fix |

### ⚠️ Uncommitted, awaiting approval

| File | What |
|---|---|
| `tailwind.config.ts` | The one-line `./lib/**/*.{ts,tsx}` content-glob fix (§6). Verified working. |
| `docs/phase-2.2-catalog-ui.md` | The Phase 2.2 report |
| `docs/phase-2.3-seed-run.md` | This document |

Only the comment fix was authorised for commit, so the accent fix was deliberately left in
the working tree rather than pushed with it.

---

## 8. Phase 2 summary

| Step | Scope | Status |
|---|---|---|
| 2.1 | Catalog API with guarded deletes | ✅ `0f1542b` |
| — | Preview deploy + Edge-bundle verification | ✅ `050fa7f` |
| 2.2 | Catalog UI + structured 409 payload | ✅ `ba807d6` |
| 2.3 | Seed run | ✅ `018d9fe` (comment fix); seed data live |

**Open for Phase 3:** the 409 "Deactivate these" flow is wired against the structured payload
and was exercised with a temporary fixture, but cannot occur in normal use until sales exist.
It needs a real re-test once the Beverages/Bakery sale modules land.
