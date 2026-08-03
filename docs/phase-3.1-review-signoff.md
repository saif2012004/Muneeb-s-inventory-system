# Phase 3.1 — review sign-off: snapshot rule amended, committed, deployed

Response to the four review decisions on prompt 3.1. The full route reference, contracts and
33-step test list stay in **`docs/phase-3.1-beverages-api.md`** — this document records what
*changed after review*, what was re-tested, and the deploy result.

**Outcome: all four items done. No UI built.**

| # | Item | Status |
|---|---|---|
| 1 | Change the re-snapshot rule (quantity no longer re-prices) | ✅ done, re-tested 8/8 |
| 2 | Keep all other decisions as implemented | ✅ unchanged |
| 3 | Commit + push | ✅ `3cf2fc6`, `a65fd61` |
| 4 | Vercel **preview** deploy, confirm Edge bundle clean | ✅ READY, middleware 78.2 kB |

---

## 1. Decision 1 — re-snapshot rule changed

### 1.1 What the rule is now

Quantity is no longer a re-price trigger. Only a **product change** or a **new line** takes a
fresh snapshot of the current catalog price.

| Edit to a line | Price behaviour |
|---|---|
| New line added | **Re-snapshot** current `product.price` |
| Line's `productId` changed | **Re-snapshot** — different item, the old price is meaningless for it |
| Line's `quantity` changed, same product | **KEEPS** its stored `unitPrice` |
| Line untouched | **KEEPS** its stored `unitPrice` |
| Explicit `unitPrice` sent for the line | That value wins over every row above |

The reason, recorded so it survives: correcting "12 crates" to "15" on a months-old sale is a
typo fix, not a re-sale. Re-pricing it at today's catalog price would silently move a
historical total the owner never asked to change.

### 1.2 How it was implemented

The decision was **extracted out of the route** into a pure function:

```
lib/sales.ts  ->  reconcileSaleLines(existing, submitted, products)
                    : LineReconciliation | SaleProblem
```

Three reasons this is worth the extra file rather than editing the predicate in place:

1. **It is the rule that must never drift.** One implementation, one place to read it.
2. **It is now testable without HTTP** — no server, no session cookie, no database. The
   evidence in §1.3 comes from executing the exact function the PATCH route calls.
3. **Phase 4 Bakery reuses it** instead of re-implementing the predicate and getting it
   subtly different.

`app/api/beverages/sales/[id]/route.ts` PATCH now just calls it and handles the result. The
duplicate-line-id (400) and foreign-line-id (409) guards moved in with it.

The one line that matters, in `lib/sales.ts`:

```ts
// NOTE: quantity is absent from this predicate on purpose — see the block
// comment above. Changing it here silently re-prices historical sales.
const productChanged = prior.productId !== line.productId;
```

### 1.3 Re-run tests — 8/8 passed

Executed `reconcileSaleLines()` against a fixture reproducing doc test 12: the stored sale is
**Big Apple ×12 @ 80, Coke ×6 @ 60** (total 1320), and the catalog has since re-priced Big
Apple to **999**.

| Case | Expected | Result |
|---|---|---|
| **quantity only, 12 → 15** | keeps **80**, no reprice | **PASS** — 80, total 1560, `repriced: []` |
| product swap → Big Lychee | re-prices to 45 | **PASS** — 45, `repriced: ["item_apple"]` |
| product swap **and** quantity change | re-prices (product drives it) | **PASS** — 45, total 1260 |
| new line added | snapshots current price | **PASS** — new line @ 45, existing lines untouched |
| explicit `unitPrice` on a product swap | override wins | **PASS** — held at 500, `repriced: []` |
| line removed, other untouched | keeps 80 | **PASS** — `removed: ["item_coke"]` |
| duplicate line id | 400 | **PASS** |
| line id from another sale | 409 | **PASS** |

**The headline result:** test 15 now shows the Big Apple line **KEEPING 80** on a
quantity-only change, where the previous implementation re-priced it to 999. Product-swap and
new-line cases still re-price, exactly as required.

`repricedItemIds` now reports only genuine re-prices, so the 3.2 UI can still flag them.

### 1.4 CLAUDE.md updated

The **Price snapshot** section under *Critical Business Rules* has been rewritten with the
table above, plus:

> **Quantity is NOT a re-price trigger, deliberately.** […] An earlier draft of this rule said
> "any changed line re-snapshots" — that was rejected on review. Do not restore it.

It also names `reconcileSaleLines()` as the single implementation and instructs Phase 4 to
reuse it rather than re-implement the predicate. That is the anti-drift guard you asked for.

### 1.5 Test list corrected

In `docs/phase-3.1-beverages-api.md`, curl test **15** now expects the line to keep 80
(`totalAmount` 1560, `repricedItemIds: []`), and a new test **15b** covers the product swap
that must still re-price. §3.1 of that document records the change rather than the old
flagged concern.

---

## 2. Decision 2 — everything else unchanged

Confirmed as implemented, no edits:

- **Deactivated products refused** on new sales (400, "Reactivate it in the catalog first.")
- **Module ownership enforced** — a Bakery product on a beverage sale is a 400, not an FK error
- **`unitPrice` override allowed on create** — necessary, all 62 seeded products sit at price 0
- **`dateTo` inclusive**, implemented as `lt` the start of the following Karachi day
- **Stable sort** — `saleDate desc, createdAt desc`, so paging can't repeat or skip a row
- **Hard delete** for sales — nothing references a sale, so there is no soft-delete case

---

## 3. Commits

| Hash | Subject |
|---|---|
| **`3cf2fc6`** | `feat: phase 3.1 - beverages sale API (snapshot-safe edits)` — 9 files, +1590 / −1 |
| **`a65fd61`** | `docs: record phase 3.1 preview deploy verification` |

Both pushed to `origin/main` (`cbf6fa2..3cf2fc6`, then `3cf2fc6..a65fd61`).

Committed to `main` rather than a branch, matching every prior phase commit in this repo. Say
so if you'd rather future phases go through branches.

`docs/prompt.txt` was deliberately left untracked — it is a prompt input, not a deliverable.

---

## 4. Vercel preview deploy — PASSED

`vercel deploy` with **no `--prod`**. `target: null` in the response confirms preview;
production is untouched.

| | |
|---|---|
| Result | **READY** — build completed in 42s |
| Preview URL | `https://muneeb-inventory-system-9x36tkriz.vercel.app` |
| Deployment id | `dpl_GdiawGKS2LaWXMucRvwTQ2iE7d6C` |
| Commit | `3cf2fc6` |
| Prisma client | generated **v6.19.3** in both `postinstall` and the build command, as designed |
| New routes | `ƒ /api/beverages/sales`, `ƒ /api/beverages/sales/[id]`, `ƒ /api/customers` — all dynamic, 0 B client JS |

This is the real build signal that `tsc --noEmit` could not give. It passed.

### 4.1 Edge bundle is clean

```
ƒ Middleware                             78.2 kB
```

Same order of magnitude as Phase 2.1, and far too small to contain the Prisma client (~1 MB+)
or bcryptjs. The split config (Gotcha 3) still holds.

Verified **behaviourally against the live preview** rather than by grepping a local artifact,
because this machine OOMs on a production build. Signed out, through `vercel curl`:

| Request | Result |
|---|---|
| `GET /api/beverages/sales` | **401** `{"data":null,"error":"You must be signed in."}`, `Content-Type: application/json` |
| `GET /api/customers` | **401**, same `{ data, error }` envelope |
| `GET /` (page) | **307** → `/login?callbackUrl=…` |
| `GET /login` | **200** HTML — the only public page |

That exercises **both arms** of the `authorized` callback in a real production build: JSON for
`/api/`, redirect for pages. Middleware executing correctly on Edge at all is itself proof the
bundle carries no Node-only dependency — if Prisma or bcryptjs had been bundled, it would fail
at the boundary rather than return a clean 401.

### 4.2 Two things worth knowing

**Preview deploys sit behind Vercel SSO Deployment Protection.** A plain `curl` gets a 302 to
`vercel.com/sso-api` *before reaching the app* — which looks exactly like a broken middleware
redirect but is not. Use `vercel curl <url>`, which authenticates through it. Worth
remembering before someone debugs a phantom auth bug.

**The build logs a Prisma deprecation warning — ignore it:**

> `warn The configuration property package.json#prisma is deprecated and will be removed in
> Prisma 7. Please migrate to a Prisma config file (e.g., prisma.config.ts).`

The warning is correct about v7 and irrelevant here. This project is pinned to Prisma v6
deliberately, and `prisma.config.ts` is an explicitly forbidden v7 pattern under the Prisma
guardrail in `CLAUDE.md`. Do not act on it.

---

## 5. Verification summary

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx next lint` (whole project) | ✔ No ESLint warnings or errors |
| `reconcileSaleLines()` executed against fixtures | **8/8 passed** |
| Karachi date transform + zod schemas, executed | verified |
| Supabase column check (read-only) | matches `schema.prisma` |
| Prisma version | `@prisma/client` 6.19.3 — v6 conventions only |
| Vercel **preview** build | **READY**, Edge bundle clean |
| Migration run? | **No** |
| UI built? | **No** |

---

## 6. Still open

1. **Context7 is not connected in this session.** It could not be used for 3.1; the routes
   were written against the reviewed Phase 2 code as the in-repo Prisma 6 pattern of record.
   Worth reconnecting before **3.2**, where the UI work leans on shadcn and TanStack Query —
   stale API knowledge bites harder there than it does with Prisma.
2. **The delete-guard re-test**, now genuinely exercisable once a sale exists. Two branches,
   not one: category / sub-category deletes give the **409 + `blockedBy`**, while the
   **product** delete **soft-deletes** (`{ deleted: "soft" }`, 200). Procedure in §6 of
   `docs/phase-3.1-beverages-api.md`. Do it after 3.2 can show the amber refusal.
3. **Phase 3.2 — Beverages UI**, not started, as instructed.
