-- The salon's AI brain (ai-brain/): what each assistant remembers about a
-- customer across channels, why every AI conversation ended, and the
-- "call this customer back" tasks the assistants leave for the desk.
CREATE TABLE IF NOT EXISTS "customer_memories" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "phone" TEXT,
  "profile" TEXT NOT NULL DEFAULT '',
  "salonNote" TEXT NOT NULL DEFAULT '',
  "preferredLang" TEXT,
  "prefs" JSONB NOT NULL DEFAULT '{}',
  "openIntent" JSONB,
  "lastChannel" TEXT,
  "lastContactAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_memories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_memories_tenantId_customerId_key" ON "customer_memories"("tenantId", "customerId");
CREATE INDEX IF NOT EXISTS "customer_memories_tenantId_phone_idx" ON "customer_memories"("tenantId", "phone");
CREATE INDEX IF NOT EXISTS "customer_memories_tenantId_lastContactAt_idx" ON "customer_memories"("tenantId", "lastContactAt");

CREATE TABLE IF NOT EXISTS "ai_sessions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "customerId" TEXT,
  "phone" TEXT,
  "lang" TEXT,
  "outcome" TEXT NOT NULL DEFAULT 'in_progress',
  "endReason" TEXT NOT NULL DEFAULT 'in_progress',
  "turns" INTEGER NOT NULL DEFAULT 0,
  "toolCalls" INTEGER NOT NULL DEFAULT 0,
  "slowTurns" INTEGER NOT NULL DEFAULT 0,
  "maxTurnMs" INTEGER NOT NULL DEFAULT 0,
  "failures" JSONB NOT NULL DEFAULT '[]',
  "bookedIds" JSONB NOT NULL DEFAULT '[]',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "ai_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_sessions_tenantId_startedAt_idx" ON "ai_sessions"("tenantId", "startedAt");
CREATE INDEX IF NOT EXISTS "ai_sessions_tenantId_externalId_idx" ON "ai_sessions"("tenantId", "externalId");
CREATE INDEX IF NOT EXISTS "ai_sessions_tenantId_customerId_idx" ON "ai_sessions"("tenantId", "customerId");

CREATE TABLE IF NOT EXISTS "ai_callback_tasks" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "phone" TEXT,
  "name" TEXT,
  "customerId" TEXT,
  "sessionId" TEXT,
  "threadId" TEXT,
  "dueAt" TIMESTAMP(3),
  "doneAt" TIMESTAMP(3),
  "doneBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_callback_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_callback_tasks_tenantId_doneAt_createdAt_idx" ON "ai_callback_tasks"("tenantId", "doneAt", "createdAt");
