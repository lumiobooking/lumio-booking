-- Turn adjustments (chia tua): turns an owner added or removed by hand, with a reason.
CREATE TABLE IF NOT EXISTS "turn_adjustments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "delta" DOUBLE PRECISION NOT NULL,
  "reason" TEXT,
  "byUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "turn_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "turn_adjustments_tenantId_day_idx" ON "turn_adjustments"("tenantId", "day");
CREATE INDEX IF NOT EXISTS "turn_adjustments_tenantId_staffId_day_idx" ON "turn_adjustments"("tenantId", "staffId", "day");

DO $$ BEGIN
  ALTER TABLE "turn_adjustments" ADD CONSTRAINT "turn_adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "turn_adjustments" ADD CONSTRAINT "turn_adjustments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
