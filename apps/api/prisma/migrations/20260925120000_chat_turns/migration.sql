-- Chat turns ("chia turn"): the rules each salon sets for handing
-- conversations to staff, the presence each person reports, and a log of
-- every turn given. All tenant-scoped.
ALTER TABLE "messenger_connections"
  ADD COLUMN IF NOT EXISTS "chatRotation" TEXT NOT NULL DEFAULT 'strict',
  ADD COLUMN IF NOT EXISTS "chatBotFirst" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "chatNeedStatus" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "chatNeedShift" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "chatNeedOnline" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "chatOnlineMins" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "chatReassignUnreadMins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "chatReassignUnrepliedMins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "chatMaxHops" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "chatAgentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "messenger_threads"
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assignHops" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "chat_agent_presence" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'available',
  "lastSeenAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chat_agent_presence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "chat_agent_presence_tenantId_userId_key" ON "chat_agent_presence"("tenantId", "userId");
DO $$ BEGIN
  ALTER TABLE "chat_agent_presence" ADD CONSTRAINT "chat_agent_presence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "chat_agent_presence" ADD CONSTRAINT "chat_agent_presence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "chat_assignment_logs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "userId" TEXT,
  "fromUserId" TEXT,
  "byUserId" TEXT,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_assignment_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "chat_assignment_logs_tenantId_createdAt_idx" ON "chat_assignment_logs"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "chat_assignment_logs_threadId_idx" ON "chat_assignment_logs"("threadId");
DO $$ BEGIN
  ALTER TABLE "chat_assignment_logs" ADD CONSTRAINT "chat_assignment_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "chat_assignment_logs" ADD CONSTRAINT "chat_assignment_logs_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "messenger_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
