-- Where each salon actually is.
--
-- The content engine has been recommending the same holidays to every salon
-- because the platform never recorded a location — only market (US/CA/VN) and
-- timezone. Nullable on purpose: existing salons keep working, and the engine
-- is written to say "khu vực chưa được điền" rather than guess a place.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
