-- Google Reviews auto-reply: one row per mirrored Google Business Profile review.
-- Idempotent so re-running on an already-migrated DB is safe.

DO $$ BEGIN
  CREATE TYPE "GoogleReviewStatus" AS ENUM ('NEW', 'DRAFTED', 'REPLIED', 'NEEDS_ATTENTION', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "google_reviews" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "googleReviewId" TEXT NOT NULL,
  "reviewerName" TEXT,
  "reviewerPhoto" TEXT,
  "starRating" INTEGER NOT NULL,
  "comment" TEXT,
  "status" "GoogleReviewStatus" NOT NULL DEFAULT 'NEW',
  "draftReply" TEXT,
  "replyText" TEXT,
  "repliedAt" TIMESTAMP(3),
  "alertedAt" TIMESTAMP(3),
  "reviewCreatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "google_reviews_tenantId_googleReviewId_key"
  ON "google_reviews" ("tenantId", "googleReviewId");
CREATE INDEX IF NOT EXISTS "google_reviews_tenantId_idx"
  ON "google_reviews" ("tenantId");
CREATE INDEX IF NOT EXISTS "google_reviews_tenantId_status_idx"
  ON "google_reviews" ("tenantId", "status");

DO $$ BEGIN
  ALTER TABLE "google_reviews"
    ADD CONSTRAINT "google_reviews_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
