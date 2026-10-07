-- Time-off requests (nghỉ phép): one salon's technicians asking for days off.
CREATE TABLE IF NOT EXISTS "time_off_requests" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "startTime" TEXT,
  "endTime" TEXT,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedByUserId" TEXT,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "time_off_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "time_off_requests_tenantId_staffId_startDate_idx" ON "time_off_requests"("tenantId", "staffId", "startDate");
CREATE INDEX IF NOT EXISTS "time_off_requests_tenantId_status_startDate_idx" ON "time_off_requests"("tenantId", "status", "startDate");

DO $$ BEGIN
  ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
