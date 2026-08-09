-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'app',
    "shopName" TEXT NOT NULL,
    "shopPhone" TEXT,
    "shopAddress" TEXT,
    "configuredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- Singleton, enforced by the DATABASE rather than by convention. Without this a
-- stray create() silently gives the app two settings rows, and the receipt then
-- depends on which one happens to be read first.
ALTER TABLE "Settings"
  ADD CONSTRAINT "Settings_singleton_check" CHECK ("id" = 'app');

-- Seed the one row, with placeholders that CANNOT be mistaken for real shop
-- details. A receipt printed before setup must be obviously unconfigured — a
-- friendly "Your Shop Name" would print something that looks finished and is
-- wrong, and the customer walks away holding it.
--
-- configuredAt stays NULL: the owner has not set anything yet, and that is the
-- fact the go-live check reads (PRE-HANDOFF CHECKLIST #2b).
-- updatedAt is NOT NULL with no DB default, so it must be supplied here.
INSERT INTO "Settings" ("id", "shopName", "shopPhone", "shopAddress", "configuredAt", "updatedAt")
VALUES (
  'app',
  'SET SHOP NAME IN SETTINGS',
  'SET PHONE IN SETTINGS',
  'SET ADDRESS IN SETTINGS',
  NULL,
  now()
);

-- RLS: REQUIRED on every new table (see "Database security" in CLAUDE.md).
-- Prisma does not manage RLS, so migrate would otherwise create this table with
-- RLS OFF and expose it through PostgREST to the public anon key. Default deny,
-- zero policies — same as the other 17 tables. Prisma is unaffected: it connects
-- as postgres, which both OWNS the table and has rolbypassrls.
ALTER TABLE public."Settings" ENABLE ROW LEVEL SECURITY;
