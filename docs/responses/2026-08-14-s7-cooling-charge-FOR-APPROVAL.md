# S7 — cooling charge (#17). **DESIGN FOR APPROVAL — needs a migration, nothing applied.**

**Date:** 2026-08-14 · **Status: 🔴 STOPPED at the migration gate.**
**#18 (billing-time price override) is CLOSED — it was already shipped.** See §1.

---

## 1. Half of S7 turns out to be done already

**#18 asked for "an optional field on the bill to type an updated price, on EVERY product".** The
unified till already does exactly that: every line carries an editable price — `Unit price`, or
`Price per litre` for milk — pre-filled from the catalog and overridable for that sale, for every
product in the inventory. What the owner types is sent as an explicit `unitPrice` and the server
snapshots it verbatim.

Evidence: S4.1 test #6 (a `275.50` override stored exactly, next to a line that took the catalog's
120 by omission) and the browser pass on the till.

**Closed in CLAUDE.md**, with the create/edit asymmetry recorded: on `/sales/[id]/edit` an existing
line's price is deliberately READ-ONLY, because the server refuses a client price on a stored line.

**So S7 is now one feature: the cooling charge.**

---

## 2. What the cooling charge has to do

From your brief:

- **Per product, per size.** A 1.5L and a 2.25L do not carry the same charge, so one global rate
  would be wrong for every size but one.
- **Set by you** in the catalog, with placeholder values until handover (~10 on 0.5L, ~20 on 1L,
  ~30 on 1.5L, ~50 on 2L/2.25L — to be confirmed).
- **At billing: a toggle** (this sale is chilled / not) **plus a rate override**, defaulting to the
  catalog value.

---

## 3. 🔴 It needs a migration — two columns

```prisma
model Product {
  /// Per-unit cooling charge the owner sets. NULL = this product is never
  /// chilled (bakery, milk), which is different from 0 = chilled but free.
  coolingCharge   Decimal? @db.Decimal(10, 2)
}

model SaleItem {
  /// The cooling rate ACTUALLY CHARGED on this line, per unit. Snapshotted with
  /// the price, for the same reason: editing the catalog must never move a past
  /// bill. 0 = not chilled.
  coolingRate     Decimal  @default(0) @db.Decimal(10, 2)
}
```

```sql
-- Migration E. ADDITIVE ONLY: two nullable/defaulted columns, no data rewritten,
-- no column dropped, no table touched beyond the ALTER.
ALTER TABLE "Product"  ADD COLUMN "coolingCharge" numeric(10,2);
ALTER TABLE "SaleItem" ADD COLUMN "coolingRate"   numeric(10,2) NOT NULL DEFAULT 0;
```

**Why `NULL` and not `0` on Product:** null means *this product is never chilled* and the till shows
no toggle at all; `0` would mean *chilled, at no charge* and would show one. Buns should not offer a
chill toggle.

**Every existing row is unaffected** — 28 products get a NULL, both `SaleItem` rows get 0, and every
stored total stays exactly what it is.

---

## 4. The money rule I need you to confirm (§7, Q1)

**Where does the charge land in the arithmetic?** My recommendation:

```
lineTotal = round( quantity × (unitPrice + coolingRate), 2 )
```

The chilled bottle simply costs more per unit, so the line total already includes it,
`netLineTotal` still equals `lineTotal`, and `totalAmount` is still `Σ netLineTotal` — **the
invariant the whole unified rework rests on stays true by construction.** Nothing in reports,
receivables or the receipt needs to learn a new concept.

The rejected alternative is a separate "Cooling" line on the bill. It would show the charge more
explicitly, but it breaks the one-line-per-product shape the receipt and the per-product report both
assume, and it doubles the rows on a 32-character roll.

**The receipt would print it as part of the unit price**, with a marker so the customer can see why
that bottle cost more:

```
Pepsi 1.5L  (chilled)
  3 × 305.00          Rs. 915.00      <- 275.00 + 30.00 cooling
```

---

## 5. What I would build after approval

| Piece | Change |
|---|---|
| Migration E | the two columns above, applied only with your go-ahead |
| Catalog | a **Cooling charge** field on the product dialog + a column in the list, beverages only |
| Till | per line: a **Chilled** toggle (only when the product has a charge) + an editable rate defaulting to the catalog value |
| Money | `computeLineTotal` gains the cooling rate — ONE implementation, in `lib/sales.ts`, as with every other money rule |
| Receipt | `(chilled)` marker and the combined unit price |
| Edit screen | the rate is read-only on an existing line, exactly like the price, for the same reason |
| Seed | placeholder charges on beverage sizes, for you to replace |

**Query budget: unchanged.** `coolingCharge` rides along in the existing product select; the rate
is written with the line.

---

## 6. What I need from you

1. **"apply migration E"** — or tell me to hold. `backup3.sql` is verified current, so the safety
   condition is met for the first time.
2. **Confirm the money rule in §4** — cooling folded into the line total (my recommendation), or a
   separate line on the bill.
3. **Placeholder rates**: 0.5L → 10, 1L → 20, 1.5L → 30, 2L/2.25L → 50. Confirm or correct; they are
   placeholders either way and you set the real ones before handover.

**Nothing is applied and no code is written until you answer.**

---

## 7. Also shipped in this pass (no migration, no approval needed)

**CHECKLIST #12 — the date filters on `/sales` now read DD/MM/YYYY.** A native `<input type="date">`
renders in the *device's* locale, which showed **mm/dd/yyyy** — so the filters read American while
every date the app prints is British/Pakistani, leaving `08/14` ambiguous. They now use the same
calendar the sale form uses, with a per-field clear button. Values on the wire are unchanged
(`yyyy-MM-dd`), so the Karachi-day filtering is untouched.

Browser-verified: picking 14/08/2026 displays `14/08/2026` and correctly returns "0 matching" (both
real bills are dated 08/08), and clearing restores them.

**Deliberately limited to the unified list** — the per-module lists retire at S9, and polishing a
screen scheduled for deletion is work thrown away.
