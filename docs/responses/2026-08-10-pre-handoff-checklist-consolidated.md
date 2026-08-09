# Pre-handoff checklist: consolidated into one section, duplicates pulled from all three homes

**Date:** 2026-08-10
**Status:** ✅ Docs committed. No code, no schema, no migration touched.

All ten items you listed are in, each with an explicit status, blockers marked
**[BLOCKS GO-LIVE]**. The important half of the job was the second sentence of your brief —
*"pull each from wherever it currently lives so there's ONE source of truth, not three"* — so the
originals are gone from the sections that held them, not left in place beside a copy.

---

## What the file looked like before

Last turn's list was an *index*: it pointed at three other places rather than replacing them. That
is one source of truth plus three near-copies, which is worse than three copies — a reader who
finds the prose version has no way to know it is the stale one. Fixed properly this time.

| Item | Used to live in | Now |
|---|---|---|
| Login POST-only fix | Authentication → a 37-line block | **Checklist #1**; Authentication keeps a 4-line stub + pointer |
| Data reset | Carried-forward → 16-line bullet | **Checklist #2**; carried-forward keeps only the `ZZ_TEST_` habit that supports it |
| Vercel Pro / Supabase backups | Deployment posture (twice — the Pro paragraph *and* "Still true regardless of plan") | **Checklist #3**; both reduced to pointers |
| `discountPercent` column drop | Carried-forward → 17-line bullet | **Checklist #9**; carried-forward keeps only the code rule ("never read it for a sale line") |
| Touch targets | Carried-forward → 8-line bullet | **Checklist #10** |
| PWA | Deployment posture §PWA **and** a carried-forward bullet pointing at it | **Checklist #11**; the posture section keeps one line + pointer |
| Region co-location | Deployment posture → 30-line block | **Checklist #14**; posture keeps the 3-line summary because the ~1.1s floor is referenced by the query-budget rule |
| Context7 | Carried-forward → open item | **Checklist → closed**, so it cannot be re-opened by a session reading old prose |
| Native date locale | **nowhere** | **Checklist #12** — added |
| On-device mobile | **nowhere** | **Checklist #13** — added |

Net: CLAUDE.md's scattered task prose collapsed into one section, and `grep` for the old status
markers (`MUST FIX`, `QUEUED`, `NEXT IN LINE`, `PRE-HANDOFF:`) now returns **nothing** outside the
checklist.

---

## The checklist as it stands

Legend `[ ]` open · `[~]` in flight · `[x]` closed, and four tiers:

**🔴 Blockers**
1. **[BLOCKS GO-LIVE]** Login POST-only fix — full symptom, the reproduced URL, why a password in a
   URL is not cosmetic, the three-part fix, and *re-test with JS disabled*
2. **[BLOCKS GO-LIVE]** Data reset — once, at handoff; what survives vs what goes; stock is the
   subtle one (all 27 products at the temporary default of 100 — the owner walks the shelf)
3. **[BLOCKS GO-LIVE]** Vercel Pro + Supabase backups — event-triggered on the client relying on
   the app, never date-triggered

**🟠 In flight** (4–8) — the unified sale rework: the unbuilt `Sale` API/UI/reports, Migration B,
`lib/receivables.ts` still summing the old tables, the client-`unitPrice`-on-update hardening, and
the UI-less `PATCH`. Marked *not* blockers — the app works on the old tables — but flagged as
having to be **finished or deliberately abandoned** before handoff, because handing over two
parallel sale schemas with one of them empty is its own trap.

**🟡 Phase 8 polish** (9–13) — discount column, touch targets, PWA, date locale, on-device.

**⚪ Handoff infra** (14–15) — region co-location, and the Data API surface decision.

**`[x]` Closed** — Context7, the delete-guard re-test, the preview-auth cookie fix, and the milk
hub/balance-sheet mismatch. Recorded deliberately so a future session does not re-open something
already settled.

Two of your items got slightly more than a copy-paste, where the reason matters more than the task:

- **#12 native date locale** — the note now says *why* it needs checking beyond the formatter: a
  native `<input type="date">` renders in the **device's** locale, which `lib/format.ts` does not
  control. That is the part that would actually be wrong on the owner's phone.
- **#13 on-device** — your phrase *"emulation is geometry, not a device"* is quoted in the file,
  with what emulation cannot reproduce spelled out (on-screen keyboard, touch accuracy, real
  latency, paint performance), and quick entry called out as the screen to test hardest since it is
  the densest and he uses it twice a day.

**Discoverability:** the process rule at the top of CLAUDE.md now ends with a pointer to the
checklist, and the Development Phases section says to work the checklist rather than the phase
table before declaring the project ready.

---

## One thing I did not write as fact

Your item 2 reads *"5 real exploratory sales / 3 customers must be cleared"*. I wrote the item so it
is correct either way, and added a bounded warning rather than a number:

> ⚠️ Confirm the count against the environment actually being handed over. In the database this
> repo points at (project `wcfdtxalwlztfsbepkrr`, the ref in `.env`), 2026-08-10 shows **1 sale, 1
> customer (Saif), Rs. 5,000** — with the sale still in the OLD `BakerySale` table. Session briefs
> have repeatedly described 5 sales across 3 customers, which no query here has reproduced. **Do
> not run a delete set sized from the wrong environment.**

A data reset is a destructive step written into the handoff instructions. Recording a row count no
query has ever returned is precisely the kind of confident-but-wrong line the process rule was
added to prevent — and on this particular item, being wrong means deleting the owner's real
records or leaving build junk in his books.

Everything else in your brief went in as written.

---

## Commit

```
docs: consolidate pre-handoff checklist
```

`CLAUDE.md` + this response. **`prisma/schema.prisma` and Migration A remain uncommitted** — schema,
not docs; they belong with the unified-sale build (checklist #4).

Stopping here for the thermal printout.

---

## ⚠️ Unrelated, but you should know: 31 tracked doc files are missing from disk

Noticed in `git status` while committing. **Not mine — I did not delete anything**, and the
deletions are **not** in either of today's commits (both staged explicit paths).

Everything dated **2026-08-08 or earlier** is gone from the working tree: all eleven
`docs/phase-*.md` reports and twenty `docs/responses/` files. Everything from 2026-08-09 onward is
still there.

```
git ls-files --deleted | wc -l   ->  31
```

**Nothing is lost** — they are all committed, so the working tree is the only copy affected:

```bash
git checkout -- docs/          # restores all 31
```

Two reasons this matters beyond tidiness:

1. **CLAUDE.md cites several of them by path** — `docs/phase-2.1-api-routes.md`,
   `docs/phase-3.2-fixes-verified.md`, `docs/responses/2026-08-04-delete-guard-retest.md`,
   `docs/responses/2026-08-09-stock-tracking-shipped.md` among others. A cold session following
   those pointers would hit missing files.
2. If the deletion **was** deliberate cleanup, the restore command above is the wrong move and the
   CLAUDE.md references should be pruned instead.

I left the working tree exactly as I found it — deciding between those two is yours, and neither
is urgent since git has the content either way.

---

### Sources used

Repository only — file reads and `grep` over CLAUDE.md to find every duplicate before moving it. No
database queries and no library lookups were needed this turn, so neither Context7 nor
`node_modules` was consulted.
