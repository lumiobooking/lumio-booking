-- Customer-facing display relay: lets an independent networked device (e.g. a
-- wireless iPad) mirror the register and post after-payment QR tips. One row per
-- tenant. Idempotent so it is safe to re-run on Render.
CREATE TABLE IF NOT EXISTS "display_sessions" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "pairCode"   TEXT NOT NULL,
  "state"      JSONB,
  "payTicket"  JSONB,
  "lastTipRef" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "display_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "display_sessions_tenantId_key" ON "display_sessions"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "display_sessions_token_key" ON "display_sessions"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "display_sessions_pairCode_key" ON "display_sessions"("pairCode");
CREATE INDEX IF NOT EXISTS "display_sessions_tenantId_idx" ON "display_sessions"("tenantId");

DO $$ BEGIN
  ALTER TABLE "display_sessions" ADD CONSTRAINT "display_sessions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
