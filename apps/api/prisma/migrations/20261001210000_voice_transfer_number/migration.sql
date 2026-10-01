-- The receptionist's phone the AI receptionist hands a caller to mid-call.
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "transferNumber" TEXT;
