-- rt204: a permanent, append-only record of every message, per salon.
CREATE TABLE IF NOT EXISTS "messenger_message_log" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "fp" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "byName" TEXT,
  "content" TEXT NOT NULL,
  "images" JSONB,
  "messageId" TEXT,
  "failed" BOOLEAN NOT NULL DEFAULT false,
  "at" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_message_log_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_message_log_threadId_fp_key" ON "messenger_message_log"("threadId", "fp");
CREATE INDEX IF NOT EXISTS "messenger_message_log_tenantId_threadId_at_idx" ON "messenger_message_log"("tenantId", "threadId", "at");
DO $$ BEGIN
  ALTER TABLE "messenger_message_log" ADD CONSTRAINT "messenger_message_log_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
