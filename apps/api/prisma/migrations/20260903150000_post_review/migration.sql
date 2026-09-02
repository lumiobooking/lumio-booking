-- Client sign-off on scheduled posts, and the comment-hold.
-- Idempotent: safe to run against a database that already has the columns.
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "approvedByName" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "heldAt" TIMESTAMP(3);
