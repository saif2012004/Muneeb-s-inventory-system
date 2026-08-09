# Settings: migration run and verified, screen shipped and browser-verified

**Date:** 2026-08-10
**Status:** ✅ Migration applied. ✅ Screen built and verified in a real browser with real saves.
⏸️ Receipt not started, as instructed.

---

## 0. One correction before the detail

The brief asks me to change the seeded values *from* `shopName = "Business Manager"` and blank
phone/address. **That was never what I drafted.** Last turn's SQL already seeded exactly the jarring
placeholders you asked for:

```
'SET SHOP NAME IN SETTINGS', 'SET PHONE IN SETTINGS', 'SET ADDRESS IN SETTINGS'
```

So there was nothing to walk back and nothing to change — the migration ran as approved. Flagging
it only because it is the fourth brief describing work differently from what is in the repo, and
silently "fixing" something that was already correct is how a real difference gets missed later.

Where "Business Manager" *does* exist: it is hardcoded in the **sidebar brand**, visible in every
screenshot below. That is a separate string from the receipt header, and it is now a natural
consumer of this table — noted as a follow-up in §6 rather than changed unasked.

---

## 1. The migration ran

```
prisma/migrations/20260810120000_add_settings/migration.sql
```

`npx prisma migrate deploy` → `6 migrations found` → **applied `20260810120000_add_settings`**.
Prisma CLI 6.19.3, over `DIRECT_URL` (session mode, :5432) as the conventions require.

### The four checks, run — not glanced at

**1. The row exists with the placeholders.**

```
id   | shopName                  | shopPhone             | shopAddress               | configuredAt
app  | SET SHOP NAME IN SETTINGS | SET PHONE IN SETTINGS | SET ADDRESS IN SETTINGS   | NULL
```

**2. RLS is on, and not FORCEd.**

| relname | relrowsecurity | relforcerowsecurity | policies |
|---|---|---|---|
| `Settings` | **true** | **false** | **0** |

`FORCE` would apply RLS to the table owner too and break Prisma; it is off, as it must be.

**3. The advisor delta — the check that actually proves the RLS line took effect.**
`get_advisors({ type: "security" })` now reports **18 × `rls_enabled_no_policy` at INFO**, up from
17, `public.Settings` among them, and **zero `rls_disabled_in_public` at ERROR**. That is the
healthy steady state described in CLAUDE.md, not a regression.

**4. The singleton constraint actually bites.** Attempted a second row inside a `DO` block:

```sql
insert into "Settings" ("id","shopName","updatedAt") values ('other','x',now());
```

→ `check_violation` raised, caught, **`Settings` row count still 1**. The guard is a database
guarantee, not a convention.

### Nothing else was touched

| | Before | After |
|---|---|---|
| `Sale` / `SaleItem` | 1 / 1 | **1 / 1** |
| `BeverageSale` / `BakerySale` / `BakerySaleItem` | 0 / 1 / 1 | **0 / 1 / 1** |
| Customers / Products / Products at stock 100 | 1 / 27 / 27 | **1 / 27 / 27** |
| Milk sales / deliveries / purchases / farmers | 1 / 1 / 1 / 1 | **1 / 1 / 1 / 1** |
| Payments / Users | 0 / 1 | **0 / 1** |
| Public tables / with RLS | 17 / 17 | **18 / 18** |
| Migrations | 5 | **6** |

The one real sale is untouched, and every new table still carries RLS.

---

## 2. What was built

| File | Role |
|---|---|
| `lib/settings-display.ts` | Dependency-free: `SETTINGS_ID`, the placeholder strings, `isPlaceholderValue`, `isConfigured`. Same server/client split as receivables and milk |
| `lib/settings.ts` | **Server only** (imports Prisma): `getSettings()`, `updateSettings()` |
| `lib/validations/settings.ts` | zod: required name, optional phone/address, `""` → `null`, placeholder rejection |
| `app/api/settings/route.ts` | `GET` + `PATCH`, `runtime = "nodejs"`, `requireOwner()` first |
| `lib/hooks/use-settings.ts` | One query, one mutation |
| `components/settings/SettingsForm.tsx` | The screen, the banner, loading/error/session states |
| `app/(dashboard)/settings/page.tsx` | Thin server shell at `/settings` |
| `lib/nav.ts` | Settings nav entry — zinc, in the mobile "More" sheet |

Three decisions worth stating, because each one is a trap avoided rather than a preference:

**The placeholders are never pre-filled into the inputs.** The stored row holds
`SET PHONE IN SETTINGS`. If the form pre-filled it, the owner would fix the shop name, press Save,
and **silently promote that placeholder into a real phone number** that then prints on every
receipt as though he had chosen it. A field holding a placeholder renders **empty**, with the
placeholder as the input's own `placeholder` attribute. The server rejects submitted placeholders as
a backstop (verified in §3), but the UI is what stops it being annoying rather than merely safe.

**One round trip per save.** `configuredAt = COALESCE("configuredAt", now())` in a raw `UPDATE`
stamps the first save and leaves it alone afterwards. The ORM cannot express that without reading
the row first, and at ~1.1s per round trip (CHECKLIST #14) that would double the cost of every save
to compute something Postgres can decide itself. `updatedAt` is set explicitly because `@updatedAt`
is applied by the Prisma client on ORM writes and a raw UPDATE bypasses it.

**The mutation writes the response into the cache instead of invalidating.** Settings is one row and
the PATCH response already contains all of it — invalidating would buy nothing and cost another
~1.1s. The seeding effect is keyed on the **fields**, not on the query object, because structural
sharing means a refetch returning identical data keeps the same reference and an effect keyed on
`query.data` would not re-run — the exact trap CLAUDE.md documents from the milk quick-entry grid.

---

## 3. Browser verification — real saves, real numbers

Signed in at `http://localhost:3000/settings`. Everything below is what the screen actually did, not
what it compiles to.

| # | Case | Result |
|---|---|---|
| 1 | **Unconfigured state** | 🔴 Rose banner: *"Your shop details are not set yet — Receipts are currently printing "SET SHOP NAME IN SETTINGS" instead of your shop name."* All three inputs **empty**, placeholders shown as grey hints ✅ |
| 2 | **Save name + phone, leave address blank** | Saved. Banner flipped to 🟢 *"Your shop details are set and printing on receipts."* ✅ |
| 3 | **What landed in the DB** | `shopName='ZZ_TEST_ Muneeb Traders'`, `shopPhone='0300-1234567'`, **`shopAddress = NULL`** (blank → null, so the receipt omits the line rather than printing an empty one), `configuredAt` stamped ✅ |
| 4 | **Submit the placeholder text as the shop name** | Rejected. Toast: *"That is the placeholder text — enter your real shop name."* Nothing written ✅ |
| 5 | **Second save (`ZZ_TEST_ Second Save`)** | `configuredAt` **unchanged** at `20:20:35.286`, `updatedAt` moved to `20:22:11.804`. The COALESCE holds — the first-configured moment is not overwritten ✅ |
| 6 | **Signed-out API** | `curl /api/settings` → **`401 {"data":null,"error":"You must be signed in."}`** — the documented JSON shape, not an HTML redirect ✅ |
| 7 | **Server query count** | Dev log shows the GET issuing **exactly one** `SELECT … FROM "public"."Settings" WHERE id = $1` ✅ |

**Cleanup:** the row was restored to the seeded state —
`SET SHOP NAME IN SETTINGS` / `SET PHONE IN SETTINGS` / `SET ADDRESS IN SETTINGS`,
**`configuredAt` back to NULL** — and re-verified on screen (the rose banner is back). That matters
beyond tidiness: leaving my `ZZ_TEST_` save in place would have made CHECKLIST #2b read as *already
done* at handoff, which is the precise failure the item exists to prevent.

`tsc --noEmit` exit 0, `next lint` **no warnings or errors**.

---

## 4. One real operational fault, found and fixed

The first browser attempt showed **skeletons forever** — no data, no error. It looked like a hung
query and was not.

`prisma generate` had failed with `EPERM … rename query_engine-windows.dll.node.tmp3984`. A dev
server was already running on port 3000 and held the engine open, so generate wrote the TypeScript
half (`index.d.ts`, which is why `tsc` passed and reported nothing wrong) but **left
`node_modules/.prisma/client/schema.prisma` at the previous day's copy and two orphaned `.tmp`
engine files behind**. A half-generated client.

Fixed with the documented procedure: stop the single server, delete `.next`, remove the `.tmp`
files, regenerate, start exactly **one** server (confirmed on 3000, not 3001). After that the log
read:

```
✓ Compiled /settings in 17s
GET /settings 200 in 18196ms
✓ Compiled /api/settings in 5.5s
GET /api/settings 200 in 8282ms
```

— first-compile cost in dev, not a runtime problem; warm requests are one query.

**Worth carrying forward:** `tsc` passing proves nothing about whether the Prisma client is
coherent, because the types regenerate even when the engine and the embedded schema do not. If a
freshly-migrated model behaves as though it does not exist, check the timestamp on
`node_modules/.prisma/client/schema.prisma` before debugging the code.

---

## 5. What I did NOT do

- **No receipt.** Waiting for your printout prompt, as instructed.
- **No mobile-viewport pass.** A 360px window resize did not actually change the rendered viewport,
  and per CLAUDE.md *emulation is geometry, not a device* — so rather than claim a check I did not
  really perform, this stays part of **CHECKLIST #13**, the on-device pass.
- **Migration A / the unified sale** untouched; `prisma/schema.prisma` now carries both the
  uncommitted `Sale`/`SaleItem` models and the new `Settings` model, committed together only
  because they live in one file (see §7).

---

## 6. Follow-up worth knowing about (not done)

The **sidebar brand still reads a hardcoded "Business Manager"** with the subtitle
"Pepsi · Bakery · Milk". Now that the owner can set his shop name, that string is the obvious next
consumer — otherwise he sets "Muneeb Traders" in Settings, sees it on his receipts, and the app he
uses all day still calls itself something else.

Deliberately not changed unasked: it is app chrome rather than the receipt header, and it needs a
decision about the unconfigured case (does the sidebar shout the placeholder too, or keep a neutral
product name?). Say the word and it is a small change.

---

## 7. Committed

```
feat: settings store and screen for owner-editable shop details
```

Includes the migration, the `Settings` model, the seven new files and the nav entry. **The
uncommitted `Sale` / `SaleItem` models from Migration A are carried in this commit** — unavoidable,
since they are edits to the same `schema.prisma`, and leaving them out would have meant committing
a schema that does not match the applied migrations. Migration A's own folder goes with the
unified-sale build (CHECKLIST #4), which is unchanged and still unstarted.

---

### Sources used

**The installed Prisma 6.19.3 CLI** (`migrate diff` last turn, `migrate deploy` and `generate` this
turn) and **the live database** via the Supabase MCP for the verification queries and advisors, plus
the **real browser** for §3. The existing repository supplied every UI pattern —
`lib/api.ts`, `lib/api-client.ts`, `use-catalog.ts` and `ProductDialog.tsx` were read directly
rather than reinvented. No Context7 lookup was needed.
