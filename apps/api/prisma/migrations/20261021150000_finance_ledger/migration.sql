-- Thu & Chi: funds, income/expense categories, vouchers, recurring costs.
-- Sales, refunds and drawer movements stay where they are; the ledger reads
-- them. CashMovement gains a category (what a drawer movement was for) and a
-- source (refund-made movements are already in the books as the refund).
CREATE TABLE IF NOT EXISTS "cash_funds" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "last4" TEXT,
  "openingCents" INTEGER NOT NULL DEFAULT 0,
  "openingDate" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_funds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cash_funds_tenantId_idx" ON "cash_funds"("tenantId");

CREATE TABLE IF NOT EXISTS "cash_categories" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "group" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "countsInPl" BOOLEAN NOT NULL DEFAULT true,
  "systemKey" TEXT,
  "budgetCents" INTEGER,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cash_categories_tenantId_systemKey_key" ON "cash_categories"("tenantId", "systemKey");
CREATE INDEX IF NOT EXISTS "cash_categories_tenantId_idx" ON "cash_categories"("tenantId");

CREATE TABLE IF NOT EXISTS "cash_entries" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "fundId" TEXT NOT NULL,
  "categoryId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "countsInPl" BOOLEAN NOT NULL DEFAULT true,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "day" TEXT NOT NULL,
  "payee" TEXT,
  "note" TEXT,
  "receiptUrl" TEXT,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceRef" TEXT,
  "transferId" TEXT,
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "approvedByUserId" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidedByUserId" TEXT,
  "voidedByName" TEXT,
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cash_entries_tenantId_code_key" ON "cash_entries"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "cash_entries_tenantId_day_idx" ON "cash_entries"("tenantId", "day");
CREATE INDEX IF NOT EXISTS "cash_entries_tenantId_fundId_idx" ON "cash_entries"("tenantId", "fundId");
CREATE INDEX IF NOT EXISTS "cash_entries_tenantId_source_sourceRef_idx" ON "cash_entries"("tenantId", "source", "sourceRef");
-- A payroll run, a stock purchase or a recurring due day is paid at most once
-- (a voided voucher frees it again). Two quick clicks cannot pay twice.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_entries_live_source_key" ON "cash_entries"("tenantId", "source", "sourceRef") WHERE "voidedAt" IS NULL AND "sourceRef" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "recurring_expenses" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "fundId" TEXT NOT NULL,
  "amountCents" INTEGER,
  "cadence" TEXT NOT NULL,
  "anchorDay" TEXT NOT NULL,
  "nextDue" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'REMIND',
  "payee" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "recurring_expenses_tenantId_idx" ON "recurring_expenses"("tenantId");

ALTER TABLE "cash_movements" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "cash_movements" ADD COLUMN IF NOT EXISTS "source" TEXT;
-- Movements the refund screen wrote before this column existed.
UPDATE "cash_movements" SET "source" = 'refund' WHERE "source" IS NULL AND "reason" LIKE 'Hoàn tiền bill #%';
