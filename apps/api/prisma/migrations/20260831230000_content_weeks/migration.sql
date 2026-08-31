-- One salon's marketing plan for one week, frozen.
--
-- The plan used to be recomputed on every read and stored nowhere, so last
-- week's plan ceased to exist the moment Monday arrived. `generated` is what
-- the system wrote; `edited` is what the Lumio team turned it into. Both are
-- kept so "what did we change, and did it work better" is answerable.
CREATE TABLE IF NOT EXISTS "content_weeks" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "weekKey"      TEXT NOT NULL,
  "startDate"    TEXT NOT NULL,
  "stageKey"     TEXT,
  "stageStep"    INTEGER,
  "generated"    JSONB NOT NULL DEFAULT '{}',
  "edited"       JSONB,
  "editedById"   TEXT,
  "editedByName" TEXT,
  "editedAt"     TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_weeks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "content_weeks_tenantId_weekKey_key"
  ON "content_weeks"("tenantId", "weekKey");
CREATE INDEX IF NOT EXISTS "content_weeks_tenantId_startDate_idx"
  ON "content_weeks"("tenantId", "startDate");

DO $$ BEGIN
  ALTER TABLE "content_weeks"
    ADD CONSTRAINT "content_weeks_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
