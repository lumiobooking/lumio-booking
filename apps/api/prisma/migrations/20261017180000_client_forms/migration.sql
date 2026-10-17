-- Massage / spa paperwork: signed intake, consent and SOAP notes, and the
-- per-visit links clients sign them through (client-forms/).
CREATE TABLE IF NOT EXISTS "client_form_entries" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT,
  "kind" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL DEFAULT 1,
  "lang" TEXT NOT NULL DEFAULT 'en',
  "answers" JSONB NOT NULL DEFAULT '{}',
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "signatureData" TEXT,
  "signedName" TEXT,
  "signerRole" TEXT NOT NULL DEFAULT 'client',
  "staffId" TEXT,
  "userId" TEXT,
  "appointmentId" TEXT,
  "walkInId" TEXT,
  "linkId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'salon',
  "ip" TEXT,
  "userAgent" TEXT,
  "addenda" JSONB NOT NULL DEFAULT '[]',
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_form_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "client_form_entries_tenantId_customerId_kind_idx" ON "client_form_entries"("tenantId", "customerId", "kind");
CREATE INDEX IF NOT EXISTS "client_form_entries_tenantId_appointmentId_idx" ON "client_form_entries"("tenantId", "appointmentId");
CREATE INDEX IF NOT EXISTS "client_form_entries_tenantId_walkInId_idx" ON "client_form_entries"("tenantId", "walkInId");
CREATE INDEX IF NOT EXISTS "client_form_entries_tenantId_signedAt_idx" ON "client_form_entries"("tenantId", "signedAt");
CREATE INDEX IF NOT EXISTS "client_form_entries_tenantId_linkId_idx" ON "client_form_entries"("tenantId", "linkId");

CREATE TABLE IF NOT EXISTS "client_form_links" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "customerId" TEXT,
  "appointmentId" TEXT,
  "walkInId" TEXT,
  "kinds" JSONB NOT NULL DEFAULT '[]',
  "lang" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "sentTo" TEXT,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_form_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "client_form_links_token_key" ON "client_form_links"("token");
CREATE INDEX IF NOT EXISTS "client_form_links_tenantId_appointmentId_idx" ON "client_form_links"("tenantId", "appointmentId");
CREATE INDEX IF NOT EXISTS "client_form_links_tenantId_walkInId_idx" ON "client_form_links"("tenantId", "walkInId");
