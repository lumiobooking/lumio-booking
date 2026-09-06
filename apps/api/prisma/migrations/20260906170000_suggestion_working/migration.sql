-- Who picked the shop's files up, and when. status 'working' sits between
-- 'done' (received, nobody's yet) and 'used' (finished).
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "workingAt" TIMESTAMP(3);
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "workingByName" TEXT;
