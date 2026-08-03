# Response — tidy before Phase 4

**Date:** 4 Aug 2026
**Task:** commit the verification docs, decide on `docs/prompt.txt`, confirm a clean tree and
Phase 3 marked ✅.
**Outcome:** all three done. Working tree **clean**. Stopped — awaiting the Phase 4 prompt.

---

## 1. Docs committed — `dc041f0`

**Correction to the framing of the ask:** the phase-3.x report docs were **already tracked**.
They went in alongside their code, so there was nothing outstanding there:

| Doc | Already committed in |
|---|---|
| `docs/phase-3.1-beverages-api.md` | `3cf2fc6` |
| `docs/phase-3.1-review-signoff.md` | `4a348b5` |
| `docs/phase-3.2-beverages-ui.md` | `72fc56d` |
| `docs/phase-3.2-browser-verification.md` | `72fc56d` |
| `docs/phase-3.2-delivery-summary.md` | `72fc56d` |
| `docs/phase-3.2-fixes-verified.md` | `72fc56d` |

The only thing genuinely untracked was **`docs/responses/`** — the run-by-run record started
last turn. Committed now:

- `2026-08-04-phase-3.2-commit-and-preview.md`
- `2026-08-04-delete-guard-retest.md`

Commit `dc041f0` — *"docs: phase 3 verification reports"* — 3 files, +339 lines. Pushed
(`889890a..dc041f0`).

**The two folders serve different purposes**, which is why they stay separate:

| Location | Contents |
|---|---|
| `docs/phase-*.md` | Technical deliverables — API contracts, test lists, design decisions |
| `docs/responses/` | Run-by-run record of what was verified, when, and what was found |

---

## 2. `docs/prompt.txt` — gitignored

Your call was mine to make; I gitignored it. It is genuinely scratch: the working file phase
prompts get pasted into, an **input** rather than a deliverable. The phase reports and the
response record are what belong in the repo.

Added to `.gitignore` with a comment saying so, placed in its own `# scratch` block at the end
— deliberately **not** inside the env block, whose existing comment warns that the
`!.env.example` negation must stay last in that block.

```gitignore
# scratch
# The working file phase prompts get pasted into. It is an INPUT, not a
# deliverable — the phase reports in docs/ and the run-by-run record in
# docs/responses/ are what belong in the repo.
docs/prompt.txt
```

Verified: `git check-ignore -v docs/prompt.txt` → `.gitignore:46`. The file stays on disk and
keeps working; it just never reaches a commit.

---

## 3. Confirmations

### Working tree clean

```
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

### Phase 3 marked ✅ — confirmed

Already set in `889890a`, as you expected. Current table:

| Phase | Scope | Status |
|---|---|---|
| 1 | Scaffold + Prisma schema + split-config auth + Vercel deploy | ✅ Done |
| 2 | Category & product manager (CRUD + inline price editor) + seed | ✅ Done |
| **3** | **Beverages module (multi-item sales, list, customer ledger)** | **✅ Done** |
| 4 | Bakery module (mirrors beverages) | ⬜ Todo |
| 4b | Customers hub + receivables (payments, outstanding balances) | ⬜ Todo |
| 5 | Milk shop: farmers, deliveries, purchases, quick-entry, milk sales | ⬜ Todo |
| 6 | Farmer net-balance ledger + all-farmers balance sheet | ⬜ Todo |
| 7 | Reports dashboard + charts + CSV export | ⬜ Todo |
| 8 | Polish: mobile nav, states, a11y, PWA, final validation | ⬜ Todo |

---

## 4. Phase 3 commit trail

| Commit | What |
|---|---|
| `3cf2fc6` | Phase 3.1 — beverages sale API (snapshot-safe edits) |
| `a65fd61` | 3.1 preview deploy verification |
| `4a348b5` | 3.1 review sign-off |
| `72fc56d` | Phase 3.2 — beverages sale UI (verified) + the four fixes |
| `889890a` | CLAUDE.md offline-safe data-fetching convention; Phase 3 marked ✅ |
| `dc041f0` | Phase 3 verification reports + gitignore scratch |

All pushed to `origin/main`. Nothing promoted to production.

---

## 5. What Phase 4 (Bakery) inherits

Already recorded in CLAUDE.md's carried-forward notes, repeated here so it is in front of you
when you write the prompt:

1. **`reconcileSaleLines()` in `lib/sales.ts` is THE price-snapshot implementation.** Reuse it
   rather than re-deriving the predicate. `SALE_DETAIL_SELECT` and `loadSaleProducts` are
   written generically because `BakerySale` has the same relation names.
2. **The global TanStack Query settings are not optional** — `networkMode: "always"` plus the
   15s `AbortSignal.timeout`.
3. **Verify UI in a real browser, not on a build.** Phase 3.2 type-checked, linted and built
   green while carrying three real bugs, one of which trapped the owner with no way to recover.
4. The delete-guard thread is now **closed** — verified at all three levels.

Stopped. Ready for the Phase 4 prompt.
