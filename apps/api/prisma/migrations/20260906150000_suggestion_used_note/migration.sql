-- What the team did with what the shop sent — one line, written when the
-- card is put away, read when somebody asks "did we use that clip?".
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "usedNote" TEXT;
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "usedAt" TIMESTAMP(3);
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "usedByName" TEXT;
