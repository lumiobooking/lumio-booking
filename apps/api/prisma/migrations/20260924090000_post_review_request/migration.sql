-- "Gửi tiệm duyệt lại": the moment the team sent an edited post back to the
-- salon. The salon's screen marks such a post as updated, and the salon's
-- phone is told. Cleared by the salon's approval.
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "reviewRequestedAt" TIMESTAMP(3);
