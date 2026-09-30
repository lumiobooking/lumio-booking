-- Cashier shifts ("ca thu ngân"): open the till with a float, tag every sale
-- with the shift, log cash in/out, count the drawer at close. Tenant-scoped.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shiftId" TEXT;
CREATE INDEX IF NOT EXISTS "orders_tenantId_shiftId_idx" ON "orders"("tenantId", "shiftId");

CREATE TABLE IF NOT EXISTS "cash_shifts" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "openedByUserId" TEXT,
  "openedByName" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "openingCents" INTEGER NOT NULL DEFAULT 0,
  "openNote" TEXT,
  "closedByUserId" TEXT,
  "closedByName" TEXT,
  "closedAt" TIMESTAMP(3),
  "expectedCashCents" INTEGER,
  "countedCents" INTEGER,
  "varianceCents" INTEGER,
  "closeNote" TEXT,
  "summary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cash_shifts_tenantId_status_idx" ON "cash_shifts"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "cash_shifts_tenantId_openedAt_idx" ON "cash_shifts"("tenantId", "openedAt");
DO $$ BEGIN
  ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "cash_movements" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT,
  "byUserId" TEXT,
  "byName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cash_movements_tenantId_shiftId_idx" ON "cash_movements"("tenantId", "shiftId");
DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
