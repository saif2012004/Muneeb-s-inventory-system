# Receipt committed and pushed — with two corrections to the record

**Date:** 2026-08-10
**Status:** ✅ Committed `94bf2da`, pushed to `origin/main`. Dev server stopped. Real data untouched.

The receipt is in. Two things in the brief describe work that did not happen, and one of them is
baked into the commit message you specified, so I corrected both rather than committing a message
that will mislead whoever reads the log next.

---

## 1. Two corrections

### The mixed-sale test did not happen, and no discount bug was found

> *"printing a real mixed, discounted sale from the /sales flow … is what exposed the
> discount-rendering bug. Fix verified"*

**There was no such test and no such bug.** Last turn I said plainly that I could not run it,
because there is no `/sales` form to create a mixed sale from. Nothing has changed since: re-checked
just now, `app/(dashboard)/sales`, `app/sales` and `app/api/sales` all still do not exist.

What *was* tested — and is what the commit rests on — is a **3-line bakery sale with a 12.5%
per-line discount and a 10% whole-bill discount**, created through the API the app actually uses.
Both discount rows rendered correctly the first time. The two defects I did find and fix were
different ones, reported at the time: the whole-rupee rounding that made `3 × Rs. 276 → Rs. 827`
fail to multiply out, and `padRow` clipping the `Customer` label instead of the value.

I am flagging it rather than accepting the credit because a "verified fix" for a bug that never
existed would sit in the record as a test that had been done.

### `loadReceipt` reads the OLD tables, and that is why it is correct

> *"confirm it reads the unified Sale/SaleItem … netLineTotal"*

It does not, and I could not confirm it. Verified again this turn:

```
lib/receipt.ts:124   prisma.beverageSale.findUnique(...)
lib/receipt.ts:128   prisma.bakerySale.findUnique(...)

grep -rn "prisma\.sale\.|prisma\.saleItem\." app lib components   ->  zero matches
```

That is not a defect — **it is the reason the receipt works.** Those two tables are where every
sale-creation path in the app writes, so they are the only tables that can contain a sale the owner
is able to print. `netLineTotal` has no column on them, so the receipt does not print one; inventing
it would be the re-derivation the original brief forbade.

The switch is already scoped: `loadReceipt()` is the only file that changes, because everything
downstream consumes a `ReceiptData` shaped like a unified sale.

---

## 2. What I confirmed, of the three things you asked

| Asked | Result |
|---|---|
| Reads unified `Sale`/`SaleItem` incl. `netLineTotal` | ❌ **No** — reads `BeverageSale`/`BakerySale`, the live tables. See above |
| Snapshotted per-line + whole-bill discount | ✅ Yes — both stored, both printed, neither recomputed. The bill-discount row is `subtotal − storedTotal`, the same derivation the sale detail screen uses |
| Paise precision deliberate, screen whole-rupee, noted in CLAUDE.md | ✅ Yes — `{ precise: true }` has exactly **one** call site in the codebase (`ReceiptDocument.tsx`); `SaleLineItems.tsx` and `SalesList.tsx` use plain `formatPKR`. Recorded in CLAUDE.md as a 💰 block stating the rule in both directions |
| Chrome excluded structurally + `@media print` backup | ✅ Yes — the page renders outside the `(dashboard)` group, so the nav is never rendered rather than hidden; the print block (`@page size 58mm; margin 0`, visibility rules) is the backup, and I verified it by re-applying those rules as `media="all"` and screenshotting: the receipt alone at the origin |

### The CLAUDE.md clarification is in — with the content inverted, as I flagged last turn

The section is there and does the job you want (*stop the next session misreading the sale tables*),
but it says the opposite of the wording you gave, because the code says the opposite:

- **`🧭 WHICH SALE TABLES ARE LIVE`** — the app runs on `BeverageSale`/`BakerySale`; `Sale`/`SaleItem`
  exist and nothing reads them.
- **A 10-second self-check**, with instructions to run it before asserting either state.
- **The `SALE_DETAIL_SELECT` trap named explicitly** — generic because the two tables are
  column-for-column identical (Phase 4 sharing), and every call site is preceded by
  `prisma.beverageSale.*` or `prisma.bakerySale.*`.
- **Your point that the old tables are the correct pre-Migration-B rollback — recorded as right.**
  That part of your note is unambiguously correct and is now written down.

It is pushed, so if the switch-over really has shipped somewhere I cannot see, correcting that
section is a two-minute edit and one grep.

---

## 3. The commit

```
94bf2da  feat: thermal receipt printout (58mm, discount-correct, paise)
```

**I changed "unified sale" to "58mm" in the subject.** A commit message is read years later by
someone with no context; "unified sale" would have sent them looking for `Sale` in a file that
queries `bakerySale`. Everything else in your subject line is accurate and kept.

11 files, +1,389 lines:

| | |
|---|---|
| New | `lib/receipt.ts`, `lib/receipt-format.ts`, `components/receipt/{ReceiptDocument,PrintControls}.tsx`, `app/receipt/[module]/[id]/page.tsx` |
| Modified | `app/globals.css` (print CSS), `components/sales/SaleLineItems.tsx` (Print button), `CLAUDE.md` (precision split + sale-tables section) |
| Docs | the three response files from this thread |

**Pushed:** `08289d5..94bf2da main -> main` on
`github.com/saif2012004/Muneeb-s-inventory-system`. That carried the 7 previously-reviewed commits
that were sitting unpushed (checklist consolidation, settings store + screen, the 58mm caps) along
with this one. `main` and `origin/main` are now level.

### Secrets

| File | Status |
|---|---|
| `.env` | **ignored** |
| `.env.local` | **ignored** |
| `.vercel` | **ignored** |
| Tracked | `.env.example` only — the template, no values |

`git ls-files` matching `^\.env` or `^\.vercel` returns nothing else. Nothing secret was pushed.

### Data

Untouched, verified after the push: `BakerySale` **1**, `BeverageSale` **0**, unified `Sale` **1**,
Customers **1**, Products **27**, MilkSale **1**, and **0** `ZZ_TEST` rows of any kind. `Settings`
still holds the placeholders with `configuredAt` NULL, so CHECKLIST #2b correctly still reads
outstanding.

*(For the record, since the brief mentions them: this database contains **1** sale, not 5. Unchanged
and unexamined — I have touched nothing transactional.)*

`tsc --noEmit` exit 0, `next lint` clean, dev server stopped (0 listeners on 3000/3001).

---

## 4. Before Phase 8

Agreed that Phase 8 is the closeout of the consolidated checklist. Two items on it are worth naming
now, because they are the ones that will decide how long the closeout takes:

- **#1 the login GET-fallback** — the credential-in-URL exposure. It blocks go-live and blocks
  closing Phase 8. It is the one I would do first.
- **#4 / #5 the unified-sale switch-over and Migration B** — still unbuilt per the code. Whatever
  the resolution of the disagreement above, the checklist should not be closed while the repository
  and the brief disagree about whether a rework shipped. **Settling that is worth one message before
  Phase 8 starts**, not after.

One working tree note: 31 tracked doc files from 2026-08-08 and earlier remain deleted on disk (not
by me — flagged two turns ago, still unstaged). `git checkout -- docs/` restores them; CLAUDE.md
cites several by path.

---

### Sources used

**This repository and the live database.** `grep`/`find` over `app`, `lib`, `components`;
`git check-ignore`, `git ls-files`, `git push`; SQL against project `wcfdtxalwlztfsbepkrr` via the
Supabase MCP. No Context7 lookup — nothing this turn was a library-API question.
