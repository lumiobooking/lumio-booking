-- The reference clip's public numbers, so the shop can weigh the brief:
-- views (YouTube) or likes (Instagram), and when it went up.
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "refCount" INTEGER;
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "refCountKind" TEXT;
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "refPublishedAt" TIMESTAMP(3);
