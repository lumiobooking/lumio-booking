-- Bilingual hotline: remember which language THIS caller chose at the menu.
ALTER TABLE "VoiceCall" ADD COLUMN IF NOT EXISTS "language" TEXT;
