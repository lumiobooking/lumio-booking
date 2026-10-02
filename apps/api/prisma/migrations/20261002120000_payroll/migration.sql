-- Payroll: pay types per technician, and pay-period runs (draft overrides +
-- the frozen record of what was paid). Additive only: every existing tech
-- stays COMMISSION at their current rate.
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "payType" TEXT NOT NULL DEFAULT 'COMMISSION';
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "productCommissionPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "hourlyRateCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "dailyGuaranteeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "salaryPeriod" TEXT NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "checkPercent" INTEGER;

-- A tech who had a base before this change was paid "commission + base per
-- period"; keep that meaning by making them SALARY + commission only when they
-- actually had a base. Everyone else is untouched.
UPDATE "staff_members" SET "payType" = 'SALARY' WHERE "baseCents" > 0 AND "payType" = 'COMMISSION';

CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "periodFrom" TEXT NOT NULL,
  "periodTo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "overrides" JSONB,
  "lines" JSONB,
  "totals" JSONB,
  "note" TEXT,
  "createdByUserId" TEXT,
  "finalizedByUserId" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_runs_tenantId_periodFrom_periodTo_key" ON "payroll_runs"("tenantId", "periodFrom", "periodTo");
CREATE INDEX IF NOT EXISTS "payroll_runs_tenantId_periodFrom_idx" ON "payroll_runs"("tenantId", "periodFrom");
DO $$ BEGIN
  ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
