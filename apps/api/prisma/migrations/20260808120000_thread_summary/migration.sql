-- Long-term customer memory per conversation (idempotent)
ALTER TABLE "messenger_threads" ADD COLUMN IF NOT EXISTS "summary" TEXT;
