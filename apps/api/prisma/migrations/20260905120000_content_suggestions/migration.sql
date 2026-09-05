-- One trend the team picked out and handed to a salon, and what the salon sent
-- back. `sourceUrl`/`sourceLabel` are the team's own working notes — which feed
-- it came off — and never reach the salon's screen (see client-view.ts).
-- Idempotent: safe on a database that already has the table.
CREATE TABLE IF NOT EXISTS "content_suggestions" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "note"          TEXT,
  "sourceUrl"     TEXT,
  "sourceLabel"   TEXT,
  "createdByName" TEXT,
  "status"        TEXT NOT NULL DEFAULT 'sent',
  "doneAt"        TIMESTAMP(3),
  "skipReason"    TEXT,
  "media"         JSONB NOT NULL DEFAULT '[]',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "content_suggestions_tenantId_status_idx"
  ON "content_suggestions" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "content_suggestions_tenantId_createdAt_idx"
  ON "content_suggestions" ("tenantId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "content_suggestions"
    ADD CONSTRAINT "content_suggestions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
