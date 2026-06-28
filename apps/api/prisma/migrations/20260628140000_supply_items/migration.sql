-- Back-of-house supplies/consumables inventory. Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS "supply_items" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "unit"              TEXT NOT NULL DEFAULT 'unit',
  "stockQty"          INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
  "costCents"         INTEGER,
  "supplier"          TEXT,
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supply_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supply_items_tenantId_idx" ON "supply_items"("tenantId");

DO $$ BEGIN
  ALTER TABLE "supply_items"
    ADD CONSTRAINT "supply_items_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
