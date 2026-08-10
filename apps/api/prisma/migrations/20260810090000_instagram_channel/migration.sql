-- Instagram handle + per-conversation channel (idempotent)
ALTER TABLE "messenger_pages" ADD COLUMN IF NOT EXISTS "igUsername" TEXT;
ALTER TABLE "messenger_threads" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'messenger';
