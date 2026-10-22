-- Restaurant table service: a bill per table while the guests eat, its dish
-- lines (unsent / sent to the kitchen / taken back), and the prep station a
-- print job is for. Every row carries tenantId.
ALTER TABLE "print_jobs" ADD COLUMN IF NOT EXISTS "station" TEXT;

CREATE TABLE IF NOT EXISTS "table_checks" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "tableIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "guests" INTEGER NOT NULL DEFAULT 1,
  "serverUserId" TEXT,
  "serverName" TEXT,
  "customerId" TEXT,
  "note" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sendCount" INTEGER NOT NULL DEFAULT 0,
  "preBilledAt" TIMESTAMP(3),
  "preBillCount" INTEGER NOT NULL DEFAULT 0,
  "changedAfterPrebill" BOOLEAN NOT NULL DEFAULT false,
  "orderId" TEXT,
  "closedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "table_checks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "table_checks_tenantId_number_key" ON "table_checks"("tenantId", "number");
CREATE INDEX IF NOT EXISTS "table_checks_tenantId_status_idx" ON "table_checks"("tenantId", "status");
DO $$ BEGIN
  ALTER TABLE "table_checks" ADD CONSTRAINT "table_checks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "table_check_lines" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "checkId" TEXT NOT NULL,
  "menuItemId" TEXT,
  "name" TEXT NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "note" TEXT,
  "station" TEXT NOT NULL DEFAULT 'KITCHEN',
  "state" TEXT NOT NULL DEFAULT 'UNSENT',
  "batch" INTEGER,
  "sentAt" TIMESTAMP(3),
  "sentByName" TEXT,
  "voidReason" TEXT,
  "voidByUserId" TEXT,
  "voidApprovedBy" TEXT,
  "voidedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "table_check_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "table_check_lines_tenantId_checkId_idx" ON "table_check_lines"("tenantId", "checkId");
DO $$ BEGIN
  ALTER TABLE "table_check_lines" ADD CONSTRAINT "table_check_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "table_check_lines" ADD CONSTRAINT "table_check_lines_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "table_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
