-- Organic Facebook/Instagram monthly insights, tenant-scoped.
-- Additive + idempotent (IF NOT EXISTS / guarded FK) so a re-run never fails.
CREATE TABLE IF NOT EXISTS "social_insights" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "followers" INTEGER,
    "newFollowers" INTEGER,
    "reach" INTEGER,
    "views" INTEGER,
    "engagement" INTEGER,
    "profileViews" INTEGER,
    "postsCount" INTEGER,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'api',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_insights_tenantId_platform_periodMonth_key"
    ON "social_insights"("tenantId", "platform", "periodMonth");
CREATE INDEX IF NOT EXISTS "social_insights_tenantId_periodMonth_idx"
    ON "social_insights"("tenantId", "periodMonth");

DO $$ BEGIN
  ALTER TABLE "social_insights"
    ADD CONSTRAINT "social_insights_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
