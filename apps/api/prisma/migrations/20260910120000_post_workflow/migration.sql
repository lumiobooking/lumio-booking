-- The team's workflow on a post: who is writing it, who is designing it,
-- where it stands, and the Drive folder its files were archived to.
--
-- `stage` defaults to 'ready' so every row that exists today keeps behaving
-- exactly as it did: only a 'ready' post may be 'scheduled', and all of them
-- are ready. The sweep reads `status` as before; `stage` is what the
-- calendar colours by and what the team moves a post through.
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "stage" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "writerName" TEXT;
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "designerName" TEXT;
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "teamNote" TEXT;
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "driveFolderUrl" TEXT;
