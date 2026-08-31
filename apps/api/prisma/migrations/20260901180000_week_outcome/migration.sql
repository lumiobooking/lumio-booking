-- What a week actually PRODUCED, and whether the client agreed to it.
--
-- Without the outcome the archive holds intentions and nothing else: open week
-- 35 and you see what was meant to happen, never what did. An agency whose
-- record is a list of intentions cannot answer the only question the client
-- really asks — did any of it work.
ALTER TABLE "content_weeks" ADD COLUMN IF NOT EXISTS "outcome" JSONB;
ALTER TABLE "content_weeks" ADD COLUMN IF NOT EXISTS "outcomeAt" TIMESTAMP(3);
ALTER TABLE "content_weeks" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "content_weeks" ADD COLUMN IF NOT EXISTS "approvedByName" TEXT;

-- The link to the post that actually went out: what turns "đã đăng" from a
-- checkbox into something anybody can open and check.
ALTER TABLE "content_ideas" ADD COLUMN IF NOT EXISTS "postedUrl" TEXT;
