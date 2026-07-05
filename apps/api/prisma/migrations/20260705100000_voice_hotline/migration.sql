-- AI Voice hotline: per-tenant voice line + per-call log.
-- Idempotent so it is safe to re-run on Render.

CREATE TABLE IF NOT EXISTS "voice_lines" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "lumioNumber"   TEXT,
  "enabled"       BOOLEAN NOT NULL DEFAULT false,
  "greeting"      TEXT,
  "language"      TEXT NOT NULL DEFAULT 'en-US',
  "voice"         TEXT,
  "aiInstruction" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voice_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "voice_lines_tenantId_key" ON "voice_lines" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "voice_lines_lumioNumber_key" ON "voice_lines" ("lumioNumber");

CREATE TABLE IF NOT EXISTS "voice_calls" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "callSid"       TEXT,
  "fromNumber"    TEXT,
  "toNumber"      TEXT,
  "transcript"    JSONB NOT NULL DEFAULT '[]',
  "outcome"       TEXT NOT NULL DEFAULT 'in_progress',
  "appointmentId" TEXT,
  "durationSec"   INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voice_calls_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "voice_calls_callSid_key" ON "voice_calls" ("callSid");
CREATE INDEX IF NOT EXISTS "voice_calls_tenantId_idx" ON "voice_calls" ("tenantId");
CREATE INDEX IF NOT EXISTS "voice_calls_tenantId_createdAt_idx" ON "voice_calls" ("tenantId", "createdAt");

-- Foreign keys (best-effort; ignore if they already exist).
DO $$ BEGIN
  ALTER TABLE "voice_lines" ADD CONSTRAINT "voice_lines_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
