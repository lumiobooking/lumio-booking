-- Receipt print queue for the reception-desk print agent. Idempotent.
DO $$ BEGIN
  CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'PRINTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "print_jobs" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "status"      "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
  "title"       TEXT,
  "text"        TEXT NOT NULL,
  "copies"      INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "printedAt"   TIMESTAMP(3),
  "error"       TEXT,
  CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "print_jobs_tenantId_status_idx" ON "print_jobs"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "print_jobs_tenantId_createdAt_idx" ON "print_jobs"("tenantId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "print_jobs"
    ADD CONSTRAINT "print_jobs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
