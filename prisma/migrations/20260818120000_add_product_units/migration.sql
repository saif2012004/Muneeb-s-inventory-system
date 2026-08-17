-- Migration F — multi-unit products (CHECKLIST #19 / S8).
--
-- ADDITIVE ONLY. One new table and two new columns; no data rewritten, nothing
-- dropped, no existing column altered.
--
-- Every existing SaleItem gets unitName NULL and unitFactor 1, which is exactly
-- what those rows mean: sold one base unit at a time. Every existing Product
-- gets no units, so nothing changes on the till until the owner adds them.

CREATE TABLE "ProductUnit" (
    "id"         TEXT NOT NULL,
    "productId"  TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "baseFactor" DECIMAL(10,2) NOT NULL,
    "price"      DECIMAL(10,2) NOT NULL,
    "isDefault"  BOOLEAN NOT NULL DEFAULT false,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductUnit_productId_name_key" ON "ProductUnit"("productId", "name");
CREATE INDEX "ProductUnit_productId_idx" ON "ProductUnit"("productId");

ALTER TABLE "ProductUnit"
    ADD CONSTRAINT "ProductUnit_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS on every new public table — Prisma does not manage this, so a migration
-- that adds a table must add it too, or the table ships readable through
-- PostgREST with the public anon key. See "Database security" in CLAUDE.md.
ALTER TABLE "ProductUnit" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "SaleItem" ADD COLUMN "unitName"   TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "unitFactor" DECIMAL(10,2) NOT NULL DEFAULT 1;
