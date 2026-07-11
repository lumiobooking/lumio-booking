-- AI Hotline: server-side call routing (rings, busy, schedule, voicemail).
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'ai';
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "forwardNumbers" TEXT;
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "ringSeconds" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "schedule" TEXT NOT NULL DEFAULT 'always';
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "customHours" JSONB;
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "noAnswerAction" TEXT NOT NULL DEFAULT 'voicemail';
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "awayMessage" TEXT;
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "voicemailSms" TEXT;

ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "recordingUrl" TEXT;
