ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "agentName" TEXT;
ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "bizIntro" TEXT;
