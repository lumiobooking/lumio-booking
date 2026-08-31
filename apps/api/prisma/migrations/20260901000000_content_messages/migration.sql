-- Messages between the Lumio team and the salon about the marketing work.
--
-- NOT the customer inbox. That one is the salon talking to people who book with
-- it; this is the salon talking to us. One table for both the per-item comments
-- and the shared window, because a comment and a chat message are the same
-- thing with a different address — two tables would mean two unread counts, two
-- notification paths, and two places to fix every bug.
CREATE TABLE IF NOT EXISTS "content_messages" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "subject"       TEXT NOT NULL DEFAULT 'general',
  "side"          TEXT NOT NULL,
  "authorId"      TEXT,
  "authorName"    TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "readByLumioAt" TIMESTAMP(3),
  "readBySalonAt" TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "content_messages_tenantId_subject_createdAt_idx"
  ON "content_messages"("tenantId", "subject", "createdAt");
CREATE INDEX IF NOT EXISTS "content_messages_tenantId_createdAt_idx"
  ON "content_messages"("tenantId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "content_messages" ADD CONSTRAINT "content_messages_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "content_messages" ADD CONSTRAINT "content_messages_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
