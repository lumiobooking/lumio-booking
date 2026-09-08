-- Which pair of people looks after which salons.
--
-- A team is a NAME, on both sides — no table, no membership rows, no
-- permission. A person carries one, a salon carries one, and the screens
-- group by it. That is deliberate: the moment a team becomes a permission,
-- covering for a colleague who is off needs an admin, and the thing this is
-- for is two people helping each other.
ALTER TABLE "users"   ADD COLUMN IF NOT EXISTS "supportTeam" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "supportTeam" TEXT;
CREATE INDEX IF NOT EXISTS "tenants_supportTeam_idx" ON "tenants"("supportTeam");
