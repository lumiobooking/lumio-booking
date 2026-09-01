-- Uploaded media is deleted once the post has been live long enough: Facebook
-- and Instagram keep their own copy, so the post is unaffected, and storage
-- stops growing in one direction for ever.
--
-- This column records that the row has been through retention — so the sweep
-- does not reconsider it, and the calendar draws a placeholder rather than a
-- broken image.
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "mediaPurgedAt" TIMESTAMP(3);

-- The sweep looks for published posts that have not been purged yet.
CREATE INDEX IF NOT EXISTS "scheduled_posts_purge_idx"
  ON "scheduled_posts"("status", "postedAt")
  WHERE "mediaPurgedAt" IS NULL;
