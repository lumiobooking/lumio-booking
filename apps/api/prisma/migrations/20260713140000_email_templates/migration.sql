-- User-saved email templates (so edits survive a deploy).
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "tenantId" TEXT,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "fromName" TEXT NOT NULL DEFAULT '',
  "replyTo" TEXT,
  "preheader" TEXT,
  "heading" TEXT,
  "body" TEXT,
  "imageUrl" TEXT,
  "ctaLabel" TEXT,
  "ctaUrl" TEXT,
  "footerNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "email_templates_scope_updatedAt_idx" ON "email_templates"("scope", "updatedAt");
DO $$ BEGIN
  ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
