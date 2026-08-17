# S8 — multi-unit products (#19). **DESIGN FOR APPROVAL. Nothing applied, no code written.**

**Date:** 2026-08-14 · **Status: 🔴 STOPPED at the migration gate.**
This is the largest remaining feature and the first one that changes what
`Product.stock` *means*, so it needs your decisions before any of it is built.

---

## 1. What you asked for

| Product | Selling units | Prices you confirmed |
|---|---|---|
| **Eggs** | dozen (12) · tray (**30**) · peti (**360** = 12 trays) | 200 / 500 / 7000 |
| **Beverages** | single bottle · **pet** (a multi-bottle pack) | per size, placeholders until handover |

And the rule that ties it together: **one stock pool.** Sell a peti and the loose-egg count must drop
by **360**, not by 1.

**🔴 Your correction, written down: the local quarter is 12 bottles per pet, not 24** — and
bottles-per-pet is **per size**, so it is a number on each product, never a constant.

---

## 2. The shape I recommend: a selling-unit table, stock in BASE units

```prisma
model ProductUnit {
  id          String  @id @default(cuid())
  productId   String
  product     Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  /// What the owner calls it: "dozen" | "tray" | "peti" | "bottle" | "pet".
  name        String
  /// How many BASE units one of these contains. 12 for a dozen, 360 for a peti,
  /// 12 for a local-quarter pet. The BASE unit is whatever `Product.stock` counts.
  baseFactor  Decimal @db.Decimal(10, 2)
  /// The price of ONE of these. A peti is not 30 × the dozen price, so each unit
  /// carries its own — that is the whole point of the feature.
  price       Decimal @db.Decimal(10, 2)
  /// Pre-selected on the till. Exactly one per product.
  isDefault   Boolean @default(false)

  @@unique([productId, name])
}
```

`SaleItem` gains the **snapshot** of what was sold, the same way it already snapshots price and module:

```prisma
  unitName    String?  // "peti" — what the bill said
  unitFactor  Decimal  @default(1) @db.Decimal(10, 2)  // 360 — what stock moved by
```

### Why a table and not more products

The alternative is three egg products (Eggs Dozen / Eggs Tray / Eggs Peti) with a pointer to a shared
stock row. That is the **discount-variant model** this project already deleted once (36 products,
CLAUDE.md's "Discounts, russ, eggs"), and it brings back the same failure: three catalog rows that can
drift in price, name and active state while claiming to be one thing.

### What changes in the money and stock rules

| | Today | With S8 |
|---|---|---|
| `unitPrice` on a line | the product's price | the **chosen unit's** price, snapshotted (no change to `computeLineTotal`) |
| Stock delta | `quantity` | **`quantity × unitFactor`** |
| `Product.stock` counts | cottons / bottles / litres, loosely | **base units** — eggs, bottles, litres |

**The stock change is the risky one**, and it lands inside `computeStockDeltas` — the function the
per-module routes share. They would pass factor 1, so their behaviour is unchanged, but this is money-
adjacent shared code and I would test it exactly as hard as the delta reconciliation was tested.

---

## 3. 🔴 Three decisions I need from you

### Q1 — What does `Product.stock` count for eggs, and what happens to today's number?

The egg product currently has `unit: "cotton"` and `stock: 100`, which nobody has ever counted — it is
the seed placeholder. Under S8, stock must be in **base units (single eggs)**, so "100" would mean 100
eggs rather than 100 cottons.

**Recommendation: leave the number alone and let it be wrong until handover.** You are already
walking the shelves and entering real counts (CHECKLIST #2), and inventing a conversion for a
placeholder would just be a different wrong number. **What is "a cotton" in eggs — is it the tray of
30, or something else?** I need that to name the units correctly.

### Q2 — Bottles per pet, per size

I need the number for each beverage size you sell as a pet. You have given me **12 for the local
quarter**. For the rest — 0.5L, 1L, 1.5L, 2.25L — tell me the pet size, or say "12 everywhere for now"
and I will seed that as a placeholder for you to correct.

### Q3 — How should reports count a mixed-unit product?

If you sell 2 peti and 3 dozen of eggs, "how many eggs did I sell" has three possible answers:

| Option | "Sales by product" would show |
|---|---|
| **A — base units (recommended)** | `756 eggs` — one row, comparable across months whatever unit it sold in |
| B — per unit | `2 peti` and `3 dozen` on separate rows |
| C — both | base total, with the unit split underneath |

**A is my recommendation**: it is the number that reconciles with stock, and stock is the thing you
check it against. B looks more detailed but makes the total unanswerable without mental arithmetic.

---

## 4. What building it involves (after approval)

| Piece | Work |
|---|---|
| **Migration F** | new `ProductUnit` table (+ RLS enable, per CLAUDE.md's rule for new tables) and two `SaleItem` columns |
| Catalog | a units editor per product — name, factor, price, default |
| Till | a unit picker on each line; price and factor come from the chosen unit |
| Stock | `computeStockDeltas` multiplies by factor; the shortfall message reports base units *and* the unit the owner typed ("3 peti = 1,080 eggs, only 400 in stock") |
| Receipt | `2 peti × 7,000.00` — the unit named, because "2 × 7,000" is meaningless without it |
| Reports | per Q3 |
| Seed | eggs 12/30/360 at 200/500/7000; beverage pets per Q2 |

**Estimated shape: bigger than S7, comparable to S4.2.** I would split it — migration first, then
catalog units, then the till — with a gate at each, rather than one large change.

---

## 5. Also done in this pass (no approval needed)

**CHECKLIST #10 — 44px touch targets, closed.** Raised once in the three primitives
(`button` 36→44, `sm` 32→44, `lg` 40→48, `icon` 36→44; `input` 36→44; `TabsTrigger` ~28→min 44),
which is what the item asked for rather than patching call sites. Browser-checked the dense screens —
catalog tables, milk quick entry, customer profile — for layout damage; none.

**🔴 And it caught a double count that S5 had just made reachable.** Saif's profile listed his ONE
milk sale TWICE — as "Milk" and as "Sale · Milk" — while the balance beside it still read 11,000
correctly. The balance path uses the SQL guard `notAMigrationCopy()`, which covers all three old
tables; `getCustomerActivity` keeps a **JS twin** of that exclusion for the ledger, and that one still
listed only beverage and bakery. Fixed, with the incident recorded in the docblock.

Worth noting how it surfaced: every automated check was green — balances right, reports right, 10/10
cooling tests passing — because the bug only existed in a *list on one screen*. Opening the page found
it.

---

## 6. Where the project stands

**Done:** the unified till, receipt, receivables, milk cutover with authoritative stock, reports +
per-product visibility, the real-sales migration, sale editing, cooling charges, DD/MM/YYYY filters,
44px targets.

**Remaining:**

1. **S8** — this document, awaiting Q1–Q3.
2. **S9** — remove the old per-module paths, then **Migration B** drops the four old tables.
   ⚠️ The first genuinely destructive step; `backup3.sql` is verified and current, so the safety
   condition is met.
3. **Phase 8 leftovers** — PWA manifest (#11) and the on-device pass on a real phone (#13).
4. **Go-live** — your real shop details in Settings, real opening stock counts (including milk's
   opening litres), the data reset, Vercel Pro + Supabase backups, and moving the function to Seoul.
