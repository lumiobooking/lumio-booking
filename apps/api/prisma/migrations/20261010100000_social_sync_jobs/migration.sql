-- Durable marketing sync queue (one row per sync run, per tenant). Idempotent.
CREATE TABLE IF NOT EXISTS "social_sync_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT,
    "periodMonth" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'daily',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_sync_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "social_sync_jobs_status_runAt_idx" ON "social_sync_jobs"("status", "runAt");
CREATE INDEX IF NOT EXISTS "social_sync_jobs_tenantId_periodMonth_createdAt_idx" ON "social_sync_jobs"("tenantId", "periodMonth", "createdAt");
DO $$ BEGIN
  ALTER TABLE "social_sync_jobs"
    ADD CONSTRAINT "social_sync_jobs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
