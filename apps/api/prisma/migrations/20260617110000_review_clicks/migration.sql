-- Logged "send to Google" taps from the direct-review landing.
-- Idempotent so it is safe to re-run on Render (migrate deploy).
CREATE TABLE IF NOT EXISTS "review_clicks" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "staffId"   TEXT,
  "deviceId"  TEXT,
  "ipHash"    TEXT,
  "counted"   BOOLEAN NOT NULL DEFAULT false,
  "reason"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_clicks_pkey" PRIMARY KEY ("id")
);

-- Safe if the table already existed without the column.
ALTER TABLE "review_clicks" ADD COLUMN IF NOT EXISTS "reason" TEXT;

CREATE INDEX IF NOT EXISTS "review_clicks_tenantId_idx" ON "review_clicks"("tenantId");
CREATE INDEX IF NOT EXISTS "review_clicks_tenantId_staffId_idx" ON "review_clicks"("tenantId", "staffId");
CREATE INDEX IF NOT EXISTS "review_clicks_tenantId_staffId_createdAt_idx" ON "review_clicks"("tenantId", "staffId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "review_clicks" ADD CONSTRAINT "review_clicks_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "review_clicks" ADD CONSTRAINT "review_clicks_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
