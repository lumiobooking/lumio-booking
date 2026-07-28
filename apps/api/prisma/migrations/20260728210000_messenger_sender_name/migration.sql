-- Customer display name on Messenger threads (additive, idempotent).
ALTER TABLE "messenger_threads" ADD COLUMN IF NOT EXISTS "senderName" TEXT;
