-- Email marketing: bulk campaigns + per-recipient outbox + unsubscribe list.
CREATE TABLE IF NOT EXISTS "email_campaigns" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "fromName" TEXT NOT NULL,
  "replyTo" TEXT,
  "preheader" TEXT,
  "heading" TEXT,
  "body" TEXT,
  "imageUrl" TEXT,
  "ctaLabel" TEXT,
  "ctaUrl" TEXT,
  "footerNote" TEXT,
  "html" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "total" INTEGER NOT NULL DEFAULT 0,
  "sent" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "email_campaigns_tenantId_createdAt_idx" ON "email_campaigns"("tenantId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "email_campaign_recipients" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "tenantId" TEXT,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_campaign_recipients_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "email_campaign_recipients_campaignId_idx" ON "email_campaign_recipients"("campaignId");
CREATE INDEX IF NOT EXISTS "email_campaign_recipients_tenantId_email_idx" ON "email_campaign_recipients"("tenantId", "email");
DO $$ BEGIN
  ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "email_suppressions" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'unsubscribed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_scope_email_key" ON "email_suppressions"("scope", "email");
