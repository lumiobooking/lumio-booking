-- Offline-checkout idempotency: a client-generated ref so re-syncing a queued
-- offline sale can never create a duplicate order. NULL for normal online orders
-- (Postgres treats NULLs as distinct, so many online orders coexist). Idempotent.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "clientRef" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_tenantId_clientRef_key"
  ON "orders"("tenantId", "clientRef");
