-- One row per social post (FB / IG / TikTok) + append-only measurements.
-- The monthly report's post count, interactions and top 5 are queries over
-- these tables. Additive + idempotent (IF NOT EXISTS / guarded FK).
CREATE TABLE IF NOT EXISTS "social_posts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "publishedDay" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'post',
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "caption" TEXT,
    "publishedVia" TEXT NOT NULL DEFAULT 'platform',
    "scheduledPostId" TEXT,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "interactions" INTEGER,
    "metricsAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "social_posts_tenantId_platform_externalId_key"
    ON "social_posts"("tenantId", "platform", "externalId");
CREATE INDEX IF NOT EXISTS "social_posts_tenantId_periodMonth_idx" ON "social_posts"("tenantId", "periodMonth");
CREATE INDEX IF NOT EXISTS "social_posts_tenantId_publishedAt_idx" ON "social_posts"("tenantId", "publishedAt");
DO $$ BEGIN
  ALTER TABLE "social_posts"
    ADD CONSTRAINT "social_posts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "social_post_metrics" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "interactions" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'api',
    CONSTRAINT "social_post_metrics_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "social_post_metrics_postId_capturedAt_idx" ON "social_post_metrics"("postId", "capturedAt");
CREATE INDEX IF NOT EXISTS "social_post_metrics_tenantId_capturedAt_idx" ON "social_post_metrics"("tenantId", "capturedAt");
DO $$ BEGIN
  ALTER TABLE "social_post_metrics"
    ADD CONSTRAINT "social_post_metrics_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "social_post_metrics"
    ADD CONSTRAINT "social_post_metrics_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
