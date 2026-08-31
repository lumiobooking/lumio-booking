-- The two numbers the promotion engine cannot work without.
--
-- commissionPct decides whether a discount is survivable at all: gross margin
-- is roughly 100 minus it. Nullable on purpose — with no value the engine
-- refuses to name a discount rather than assume a margin.
--
-- nearbyZips feeds the area demographics. Entered by hand; nothing geocodes a
-- five-mile radius here.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "commissionPct" INTEGER;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "nearbyZips" TEXT;
