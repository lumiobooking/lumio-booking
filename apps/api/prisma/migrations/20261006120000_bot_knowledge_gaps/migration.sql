-- Questions the bot could not answer (or a person answered by hand), per salon.
-- The owner answers each once; the answer becomes a bot fact.
CREATE TABLE IF NOT EXISTS "bot_knowledge_gaps" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "threadId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'bot',
  "suggestedAnswer" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "answer" TEXT,
  "answeredBy" TEXT,
  "answeredAt" TIMESTAMP(3),
  "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_knowledge_gaps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "bot_knowledge_gaps_tenantId_key_key" ON "bot_knowledge_gaps"("tenantId", "key");
CREATE INDEX IF NOT EXISTS "bot_knowledge_gaps_tenantId_status_lastAt_idx" ON "bot_knowledge_gaps"("tenantId", "status", "lastAt");
DO $$ BEGIN
  ALTER TABLE "bot_knowledge_gaps" ADD CONSTRAINT "bot_knowledge_gaps_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
