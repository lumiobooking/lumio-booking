-- Anti-abuse: anchor rewardable feedback to a real visit.
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "feedbacks_tenantId_appointmentId_idx" ON "feedbacks" ("tenantId", "appointmentId");
