-- TikTok as a place the calendar posts to. The post carries only what the
-- person decided for it (privacy level, comment/duet/stitch, commercial
-- disclosure); the account's token stays on the tenant's Setting row.
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "tiktok" JSONB;
