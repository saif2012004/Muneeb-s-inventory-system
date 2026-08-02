-- Enable Row Level Security on every table in `public`, with NO policies.
--
-- WHY: Supabase exposes every `public` table through PostgREST, and the anon
-- key is public by design (it ships to browsers). Without RLS, anyone holding
-- that key could read or write every customer, sale and payment row over
-- https://<ref>.supabase.co/rest/v1/... with no login at all.
--
-- WHY NO POLICIES: this app never uses Supabase Auth, the anon key, or the
-- Data API. All database access goes through Prisma, which connects as the
-- `postgres` role — that role both OWNS these tables and has BYPASSRLS, so it
-- is unaffected. RLS-on with zero policies is therefore a clean default-deny
-- for anon/authenticated while leaving the app untouched.
--
-- DO NOT add anon/authenticated policies and DO NOT disable RLS.
-- See the "Database security" section in CLAUDE.md.
--
-- Identifiers are quoted: Prisma's table names are case-sensitive.

ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Category"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SubCategory"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Product"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Customer"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CustomerPayment"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BeverageSale"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BeverageSaleItem"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BakerySale"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BakerySaleItem"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Farmer"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MilkDelivery"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FarmerPurchase"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MilkSale"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User"               ENABLE ROW LEVEL SECURITY;
