-- What the owner MEANS by a short instruction, spelled out for the AI
-- (ai-brain/instructions.ts interpretPrompt), the same read back to the owner,
-- and the wording it was written for. All optional: a row without them is
-- used with the owner's words exactly as before.
ALTER TABLE "ai_instructions" ADD COLUMN IF NOT EXISTS "meaning" TEXT;
ALTER TABLE "ai_instructions" ADD COLUMN IF NOT EXISTS "meaningNote" TEXT;
ALTER TABLE "ai_instructions" ADD COLUMN IF NOT EXISTS "meaningKey" TEXT;
