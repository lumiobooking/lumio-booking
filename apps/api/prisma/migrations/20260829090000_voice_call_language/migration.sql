-- Bilingual hotline: remember which language THIS caller chose at the menu.
-- (Prisma model VoiceCall @@maps to "voice_calls" — the first version of this
-- migration used the model name and failed both deploys.)
ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "language" TEXT;
