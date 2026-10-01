-- Two-button customer feedback: requests, cases, case events, staff coaching.
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "sentiment" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "reasons" JSONB;
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "wantsContact" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "requestId" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "orderId" TEXT;

CREATE TABLE IF NOT EXISTS "feedback_requests" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "orderId" TEXT,
  "appointmentId" TEXT,
  "walkInId" TEXT,
  "customerId" TEXT,
  "staffId" TEXT,
  "customerName" TEXT,
  "phone" TEXT,
  "serviceNames" JSONB,
  "visitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "smsDueAt" TIMESTAMP(3),
  "smsSentAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "feedbackId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "feedback_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_requests_token_key" ON "feedback_requests"("token");
CREATE INDEX IF NOT EXISTS "feedback_requests_tenantId_createdAt_idx" ON "feedback_requests"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "feedback_requests_tenantId_orderId_idx" ON "feedback_requests"("tenantId", "orderId");
CREATE INDEX IF NOT EXISTS "feedback_requests_tenantId_customerId_idx" ON "feedback_requests"("tenantId", "customerId");
CREATE INDEX IF NOT EXISTS "feedback_requests_status_smsDueAt_idx" ON "feedback_requests"("status", "smsDueAt");

CREATE TABLE IF NOT EXISTS "feedback_cases" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "feedbackId" TEXT NOT NULL,
  "customerId" TEXT,
  "staffId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "assigneeUserId" TEXT,
  "assigneeName" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "firstResponseAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "wonBack" BOOLEAN,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "feedback_cases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_cases_feedbackId_key" ON "feedback_cases"("feedbackId");
CREATE INDEX IF NOT EXISTS "feedback_cases_tenantId_status_idx" ON "feedback_cases"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "feedback_cases_tenantId_staffId_idx" ON "feedback_cases"("tenantId", "staffId");
CREATE INDEX IF NOT EXISTS "feedback_cases_tenantId_createdAt_idx" ON "feedback_cases"("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "feedback_case_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "byUserId" TEXT,
  "byName" TEXT,
  "text" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_case_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "feedback_case_events_tenantId_caseId_idx" ON "feedback_case_events"("tenantId", "caseId");

CREATE TABLE IF NOT EXISTS "staff_coaching" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "goalPct" INTEGER,
  "goalUntil" TIMESTAMP(3),
  "byUserId" TEXT,
  "byName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_coaching_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "staff_coaching_tenantId_staffId_idx" ON "staff_coaching"("tenantId", "staffId");

DO $$ BEGIN
  ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "feedback_cases" ADD CONSTRAINT "feedback_cases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "feedback_case_events" ADD CONSTRAINT "feedback_case_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "feedback_case_events" ADD CONSTRAINT "feedback_case_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "feedback_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "staff_coaching" ADD CONSTRAINT "staff_coaching_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
