# Phase 3.2 — delivery summary

Short-form answer to prompt 3.2. The **full detail lives in
`docs/phase-3.2-beverages-ui.md`** — route-by-route decisions, the Motion breakdown and the
46-step manual test list. This page is the summary, the open decision, and the honest gaps.

**Status: built, build-verified, NOT committed.** UI only — the 3.1 API routes were not
touched. No schema change, no migration.

---

## 1. Files

**15 new, 1 modified.**

| Area | Files |
|---|---|
| Pages | `app/(dashboard)/beverages/page.tsx`, `app/(dashboard)/beverages/new-sale/page.tsx` |
| Form | `NewSaleForm.tsx`, `LineItemRow.tsx`, `ProductPicker.tsx`, `CustomerCombobox.tsx`, `SaleDatePicker.tsx` |
| List | `SalesList.tsx`, `SaleLineItems.tsx`, `DeleteSaleDialog.tsx` |
| Shared | `components/shared/AnimatedMoney.tsx` |
| Lib | `lib/hooks/use-beverage-sales.ts`, `lib/hooks/use-customers.ts`, `lib/beverage-catalog.ts`, `lib/validations/beverage-sale-form.ts` |
| **Modified** | `lib/format.ts` — added `karachiToday()`, `toDateKey()`, `formatPickedDate()` |

Everything data-related goes through `lib/api-client.ts`; nothing calls `fetch` directly.

---

## 2. Build verified

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx next lint` (whole project) | ✔ No ESLint warnings or errors |
| Dev server | `/login` 200 · `/beverages` 307 → login · `/api/beverages/sales` **401 JSON** |
| **Vercel preview production build** | **READY** — `✓ Compiled successfully`, types valid |
| Preview URL | `https://muneeb-inventory-system-9dvgqwzcf.vercel.app` (`target: null` = preview) |
| Deployment | `dpl_EesCcjTLPA1B1qNfUS7YJtzR5Ti5` |
| Edge bundle | `ƒ Middleware 78.2 kB` — unchanged, the split still holds |
| New routes | `ƒ /beverages` 4.19 kB (220 kB first load) · `ƒ /beverages/new-sale` 31.7 kB (285 kB) |
| Build warnings | only the known `package.json#prisma` v7 notice — ignore, we are pinned to v6 |

This is the real build signal that `tsc` alone cannot give. It passed.

---

## 3. The one decision that needs your call

### `framer-motion` kept — NOT migrated to `motion`

The Motion AI Kit instructs: *"Never `framer-motion`… if the project still imports it,
migrate it."* **I did not migrate.** The reason is technical, not habit:

- Five files already import `framer-motion` — `Sidebar`, `BottomNav`, `StatCard`,
  `ProductTable`, `login-form`.
- Adding `motion/react` in the new files alongside them ships **two copies of the animation
  runtime** and — the real problem — **two separate React contexts**. A `LayoutGroup` or
  `MotionConfig` in one package cannot coordinate layout animation in the other, so shared
  layout animation would silently half-work.
- `framer-motion@12` and `motion@12` are the same engine; `motion` is the rebrand.
- `CLAUDE.md` lists the stack as "Framer Motion", and this prompt was scoped *UI only*.

So it is all-or-nothing, and an all-files swap is a stack change beyond this prompt.

**Recommendation:** a separate, mechanical task — add `motion`, codemod six files' imports,
drop `framer-motion`, update the CLAUDE.md stack row. Low-risk done whole; risky done
halfway. Confirm and I'll run it.

---

## 4. What I could NOT verify

**I did not exercise the screens in a browser.**

Doing so needs a signed-in session, and the only ways to get one were to reset your owner
password or write test customers and sales into your live Supabase project. I was not going
to do either without asking.

So: the preview build proves the pages **compile and type-check**. It does not prove they
**behave**. §4 of `docs/phase-3.2-beverages-ui.md` is the 46-step list that does — grouped
into happy path, validation, server-error handling, the sales list, and a craft bar
(360px phone, numeric keypads, keyboard-only operation, reduced motion).

**Offer:** I can create a throwaway login, drive both screens with the Chrome tools, and
delete the test rows afterwards. Say the word and it's done in one pass.

---

## 5. Motion+ disclosure

The Motion codex search for the list add/remove pattern matched **three Motion+ examples
whose source was not available to me**:

| Example | MotionScore | Public demo |
|---|---|---|
| Radix: Toast | A | <https://examples.motion.dev/react/radix-toast> |
| Base UI: Toast | S | <https://examples.motion.dev/react/base-toast> |
| Radix: Context Menu | S | <https://examples.motion.dev/react/radix-context-menu> |

Those demo pages are public and safe to share. **Full source is a Motion+ benefit** —
<https://motion.dev/plus>, a one-time payment, not a subscription — and members get it
through the Motion+ MCP server. Your `motion-plus` server is registered but currently
returns `401 Sign in to Motion to use this server`; sign in from your editor's MCP settings
to unlock it.

I did not reconstruct their source from the descriptions, and did not need to: the free
`exit-animation` result (MotionScore S) covers the pattern used here.

---

## 6. Next

1. **Run the §4 test list** in `docs/phase-3.2-beverages-ui.md`.
2. **Then the delete-guard re-test** — recording a sale creates the first real
   `BeverageSaleItem` rows, which finally makes the Phase 2 guard testable. **Two branches,
   not one:** a category / sub-category delete gives the **409 + `blockedBy`**, while the
   **product** delete **soft-deletes** with a 200. Procedure in §5 of the same document.
3. **Decide on the `motion` migration** (§3 above).

### Worth weighing later

`/beverages/new-sale` is **285 kB first load**, the heaviest route in the app (`/catalog` is
264 kB). It is cmdk + react-day-picker + framer-motion, all genuinely used — acceptable on a
modern phone, less so on a cheap Android over a slow link. Revisit in Phase 8 if it feels
slow on the owner's actual device; the calendar is the easiest win, since the sales-list
filter row already uses a plain `<input type="date">`.

---

**Not committed. Nothing promoted to production. API routes untouched.**
