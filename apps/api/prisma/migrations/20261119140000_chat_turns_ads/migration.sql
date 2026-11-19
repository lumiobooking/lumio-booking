-- Chia turn đợt 1 (19 Nov 2026): customers from ads get shorter turn times; long waits are escalated.
ALTER TABLE "messenger_threads" ADD COLUMN IF NOT EXISTS "adId" TEXT;
ALTER TABLE "messenger_threads" ADD COLUMN IF NOT EXISTS "adAt" TIMESTAMP(3);
ALTER TABLE "messenger_threads" ADD COLUMN IF NOT EXISTS "escalatedAt" TIMESTAMP(3);
ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "chatReassignAdMins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "chatEscalateMins" INTEGER NOT NULL DEFAULT 0;
