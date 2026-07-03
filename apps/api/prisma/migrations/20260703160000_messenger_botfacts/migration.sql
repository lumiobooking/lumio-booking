-- Structured FAQ facts the salon ticks/fills so the bot answers common questions.
ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "botFacts" JSONB NOT NULL DEFAULT '[]';
