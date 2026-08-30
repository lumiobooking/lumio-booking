-- Daily content advisory: format library, weekly trend notes, per-salon ideas.
CREATE TABLE IF NOT EXISTS "content_formats" (
  "id" TEXT NOT NULL,
  "industry" TEXT NOT NULL,
  "niche" TEXT,
  "name" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "hookGuide" TEXT,
  "shotList" TEXT,
  "lengthSec" INTEGER,
  "audience" TEXT,
  "heat" TEXT NOT NULL DEFAULT 'steady',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "content_formats_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "content_formats_industry_heat_active_idx" ON "content_formats"("industry", "heat", "active");

CREATE TABLE IF NOT EXISTS "trend_notes" (
  "id" TEXT NOT NULL,
  "industry" TEXT NOT NULL,
  "niche" TEXT,
  "region" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trend_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "trend_notes_industry_active_expiresAt_idx" ON "trend_notes"("industry", "active", "expiresAt");

CREATE TABLE IF NOT EXISTS "content_ideas" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "forDate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "rank" INTEGER NOT NULL DEFAULT 1,
  "formatId" TEXT,
  "formatName" TEXT,
  "title" TEXT NOT NULL,
  "hook" TEXT,
  "shotList" TEXT,
  "caption" TEXT,
  "hashtags" TEXT,
  "bestTime" TEXT,
  "reason" TEXT,
  "signals" JSONB NOT NULL DEFAULT '{}',
  "publishedAt" TIMESTAMP(3),
  "doneAt" TIMESTAMP(3),
  "resultNote" TEXT,
  "aiModel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "content_ideas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "content_ideas_tenantId_forDate_idx" ON "content_ideas"("tenantId", "forDate");
CREATE INDEX IF NOT EXISTS "content_ideas_tenantId_status_idx" ON "content_ideas"("tenantId", "status");

DO $$ BEGIN
  ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_formatId_fkey"
    FOREIGN KEY ("formatId") REFERENCES "content_formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
