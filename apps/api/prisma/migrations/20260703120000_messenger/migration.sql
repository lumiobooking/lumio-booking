-- Messenger bot: per-tenant Page connection + conversation threads. Idempotent.

CREATE TABLE IF NOT EXISTS "messenger_connections" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "pageToken" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "greeting" TEXT,
  "aiInstruction" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_connections_tenantId_key" ON "messenger_connections" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_connections_pageId_key" ON "messenger_connections" ("pageId");

CREATE TABLE IF NOT EXISTS "messenger_threads" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "history" JSONB NOT NULL DEFAULT '[]',
  "lastText" TEXT,
  "handoff" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_threads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_threads_pageId_senderId_key" ON "messenger_threads" ("pageId", "senderId");
CREATE INDEX IF NOT EXISTS "messenger_threads_tenantId_idx" ON "messenger_threads" ("tenantId");
CREATE INDEX IF NOT EXISTS "messenger_threads_tenantId_updatedAt_idx" ON "messenger_threads" ("tenantId", "updatedAt");

DO $$ BEGIN
  ALTER TABLE "messenger_connections" ADD CONSTRAINT "messenger_connections_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "messenger_threads" ADD CONSTRAINT "messenger_threads_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
