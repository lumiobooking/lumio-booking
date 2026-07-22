-- Marketing module Phase 1: manual spend, work log, and monthly report.
-- Additive only — no existing table is touched.
CREATE TABLE IF NOT EXISTS "marketing_spends" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "periodMonth" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "reach" INTEGER,
  "clicks" INTEGER,
  "leads" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "note" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_spends_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_spends_tenantId_channel_periodMonth_key" ON "marketing_spends"("tenantId","channel","periodMonth");
CREATE INDEX IF NOT EXISTS "marketing_spends_tenantId_periodMonth_idx" ON "marketing_spends"("tenantId","periodMonth");

CREATE TABLE IF NOT EXISTS "marketing_work_logs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "periodMonth" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'other',
  "title" TEXT NOT NULL,
  "note" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_work_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "marketing_work_logs_tenantId_periodMonth_idx" ON "marketing_work_logs"("tenantId","periodMonth");

CREATE TABLE IF NOT EXISTS "marketing_reports" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "periodMonth" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'review',
  "content" JSONB NOT NULL DEFAULT '{}',
  "dataSnapshot" JSONB NOT NULL DEFAULT '{}',
  "aiModel" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_reports_tenantId_periodMonth_key" ON "marketing_reports"("tenantId","periodMonth");
CREATE INDEX IF NOT EXISTS "marketing_reports_tenantId_periodMonth_idx" ON "marketing_reports"("tenantId","periodMonth");

-- Foreign keys (match Prisma onDelete: Cascade)
ALTER TABLE "marketing_spends" ADD CONSTRAINT "marketing_spends_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_work_logs" ADD CONSTRAINT "marketing_work_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_reports" ADD CONSTRAINT "marketing_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
