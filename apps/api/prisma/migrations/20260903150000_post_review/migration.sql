-- Client sign-off on scheduled posts, and the comment-hold.
-- The model is ScheduledPost but the TABLE is @@map'd to "scheduled_posts" -
-- the first version of this file altered a relation that does not exist.
-- Idempotent: safe on a database that already has the columns.
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "approvedByName" TEXT;
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "heldAt" TIMESTAMP(3);
