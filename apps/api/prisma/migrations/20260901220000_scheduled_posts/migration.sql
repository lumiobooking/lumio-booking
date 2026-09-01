-- Scheduled posts: the queue that turns the weekly content plan into posts that
-- actually go out, on the salon's own Page and Instagram account.
--
-- Written by hand and made idempotent: this database has been migrated by hand
-- before, so a table that already exists must not stop a deploy.

CREATE TABLE IF NOT EXISTS "scheduled_posts" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "ideaId"        TEXT,
  "channels"      JSONB NOT NULL DEFAULT '["facebook"]',
  "message"       TEXT NOT NULL,
  "imageUrl"      TEXT,
  "scheduledAt"   TIMESTAMP(3) NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'draft',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "lastError"     TEXT,
  "results"       JSONB NOT NULL DEFAULT '[]',
  "postedAt"      TIMESTAMP(3),
  "createdByName" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "scheduled_posts"
    ADD CONSTRAINT "scheduled_posts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "scheduled_posts_tenantId_status_scheduledAt_idx"
  ON "scheduled_posts"("tenantId", "status", "scheduledAt");
-- The scheduler's own sweep is cross-tenant by nature, so it gets its own index.
CREATE INDEX IF NOT EXISTS "scheduled_posts_status_scheduledAt_idx"
  ON "scheduled_posts"("status", "scheduledAt");
