-- Friends/family booked together share a groupId (idempotent).
-- partySize says how many came; groupId says WHICH rows came together, which
-- is what the calendar and the till actually need.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
CREATE INDEX IF NOT EXISTS "appointments_tenantId_groupId_idx" ON "appointments" ("tenantId", "groupId");
