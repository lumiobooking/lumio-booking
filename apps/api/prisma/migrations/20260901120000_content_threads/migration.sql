-- The operating state of one conversation: who owns it, and whether it is done.
--
-- Almost everything an inbox row needs is derivable from the messages. Two
-- things are not, and both are what let this survive a year of use: WHO is
-- handling a thread (with six staff and forty salons, an unassigned thread is
-- one everybody assumes somebody else answered) and WHETHER IT IS CLOSED (a
-- discussion that can never end turns the inbox into a wall, and a wall gets
-- ignored — at which point the channel is dead whatever the code does).
CREATE TABLE IF NOT EXISTS "content_threads" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "subject"        TEXT NOT NULL,
  "assigneeId"     TEXT,
  "assigneeName"   TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "resolvedByName" TEXT,
  "lastMessageAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSide"       TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_threads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "content_threads_tenantId_subject_key"
  ON "content_threads"("tenantId", "subject");
CREATE INDEX IF NOT EXISTS "content_threads_lastMessageAt_idx" ON "content_threads"("lastMessageAt");
CREATE INDEX IF NOT EXISTS "content_threads_tenantId_resolvedAt_idx" ON "content_threads"("tenantId", "resolvedAt");

DO $$ BEGIN
  ALTER TABLE "content_threads" ADD CONSTRAINT "content_threads_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "content_threads" ADD CONSTRAINT "content_threads_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
