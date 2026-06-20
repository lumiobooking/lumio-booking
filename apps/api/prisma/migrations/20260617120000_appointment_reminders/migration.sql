-- No-show reduction: per-appointment reminder + confirmation tracking.
-- Idempotent so it is safe to re-run on Render.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "remind1SentAt" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "remind2SentAt" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "customerConfirmedAt" TIMESTAMP(3);

-- Helps the reminder dispatcher scan upcoming appointments efficiently.
CREATE INDEX IF NOT EXISTS "appointments_tenantId_startTime_status_idx" ON "appointments"("tenantId", "startTime", "status");
