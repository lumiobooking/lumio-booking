-- Outreach contacts + the follow-up automation.
CREATE TABLE IF NOT EXISTS "email_contacts" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "tenantId" TEXT,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "company" TEXT,
  "note" TEXT,
  "replied" BOOLEAN NOT NULL DEFAULT false,
  "repliedAt" TIMESTAMP(3),
  "sends" INTEGER NOT NULL DEFAULT 0,
  "lastSentAt" TIMESTAMP(3),
  "lastStep" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_contacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_contacts_scope_email_key" ON "email_contacts"("scope", "email");
CREATE INDEX IF NOT EXISTS "email_contacts_tenantId_idx" ON "email_contacts"("tenantId");
CREATE INDEX IF NOT EXISTS "email_contacts_scope_replied_idx" ON "email_contacts"("scope", "replied");
DO $$ BEGIN
  ALTER TABLE "email_contacts" ADD CONSTRAINT "email_contacts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "email_automations" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "tenantId" TEXT,
  "name" TEXT NOT NULL DEFAULT 'Follow-up',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "everyDays" INTEGER NOT NULL DEFAULT 30,
  "dailyCap" INTEGER NOT NULL DEFAULT 100,
  "fromName" TEXT NOT NULL DEFAULT '',
  "replyTo" TEXT,
  "steps" JSONB NOT NULL DEFAULT '[]',
  "lastRunAt" TIMESTAMP(3),
  "sentTotal" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_automations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_automations_scope_key" ON "email_automations"("scope");
DO $$ BEGIN
  ALTER TABLE "email_automations" ADD CONSTRAINT "email_automations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed contacts from everyone already emailed, so the list isn't empty on day one.
INSERT INTO "email_contacts" ("id", "scope", "tenantId", "email", "sends", "lastSentAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), COALESCE(r."tenantId", 'platform'), r."tenantId", r."email",
       COUNT(*)::int, MAX(r."sentAt"), NOW(), NOW()
FROM "email_campaign_recipients" r
GROUP BY COALESCE(r."tenantId", 'platform'), r."tenantId", r."email"
ON CONFLICT ("scope", "email") DO NOTHING;
