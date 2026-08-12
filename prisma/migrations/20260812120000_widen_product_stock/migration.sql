-- Migration D — widen Product.stock from Int to Decimal(10,2).
--
-- WHY: milk sells in fractional litres. A 12.5 L sale cannot decrement an
-- integer column, and the unified sale treats a milk line as an ordinary
-- product line. This is the twin of Migration C, which widened
-- SaleItem.quantity for the same reason.
--
-- LOSSLESS: verified against the live database before writing. All 27 rows hold
-- exactly 100 — zero nulls, zero fractional values, zero values too large for
-- DECIMAL(10,2). Product.price in the same table is already numeric(10,2), so
-- this is the established shape here rather than a new one.
--
-- Widening only. No data migration, no other column, no other table. Postgres
-- rewrites the column in place and every existing 100 becomes 100.00.
--
-- Generated with `prisma migrate diff --from-schema-datasource` (read-only
-- introspection). NOT via a shadow database — see "DATABASE SAFETY" in
-- CLAUDE.md.

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "stock" SET DEFAULT 100,
ALTER COLUMN "stock" SET DATA TYPE DECIMAL(10,2);
