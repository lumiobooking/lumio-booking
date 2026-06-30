-- Direct-tip log: tips paid straight to a technician (QR/cash). The salon never
-- holds the money; this is recorded only so payroll/reports can show each tech's
-- tips. Idempotent: safe to re-run on Render.
CREATE TABLE IF NOT EXISTS "tip_logs" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "staffMemberId"   TEXT NOT NULL,
  "amountCents"     INTEGER NOT NULL,
  "method"          TEXT NOT NULL DEFAULT 'DIRECT',
  "note"            TEXT,
  "orderId"         TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tip_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tip_logs_tenantId_createdAt_idx" ON "tip_logs"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "tip_logs_staffMemberId_idx" ON "tip_logs"("staffMemberId");

DO $$ BEGIN
  ALTER TABLE "tip_logs" ADD CONSTRAINT "tip_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tip_logs" ADD CONSTRAINT "tip_logs_staffMemberId_fkey"
    FOREIGN KEY ("staffMemberId") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
