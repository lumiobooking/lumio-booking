-- Stock in/out log for supplies ("sổ nhập/xuất kho"). Idempotent: safe to re-run.
DO $$ BEGIN
  CREATE TYPE "StockMoveReason" AS ENUM ('PURCHASE', 'USE', 'DAMAGE', 'RETURN', 'ADJUST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "supply_movements" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "supplyItemId"  TEXT NOT NULL,
  "delta"         INTEGER NOT NULL,
  "reason"        "StockMoveReason" NOT NULL,
  "note"          TEXT,
  "unitCostCents" INTEGER,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supply_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supply_movements_tenantId_supplyItemId_idx"
  ON "supply_movements"("tenantId", "supplyItemId");

DO $$ BEGIN
  ALTER TABLE "supply_movements"
    ADD CONSTRAINT "supply_movements_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "supply_movements"
    ADD CONSTRAINT "supply_movements_supplyItemId_fkey"
    FOREIGN KEY ("supplyItemId") REFERENCES "supply_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
