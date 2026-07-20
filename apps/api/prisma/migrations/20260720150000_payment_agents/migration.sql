-- v2 relay: Bridge/Companion agents (USB + Bluetooth). Additive.
CREATE TABLE IF NOT EXISTS "payment_agents" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT,
  "platform" TEXT,
  "locationId" TEXT,
  "pairingCode" TEXT,
  "pairingExpiresAt" TIMESTAMP(3),
  "tokenHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'UNPAIRED',
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_agents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "payment_agents_tenantId_idx" ON "payment_agents"("tenantId");
CREATE INDEX IF NOT EXISTS "payment_agents_tokenHash_idx" ON "payment_agents"("tokenHash");
ALTER TABLE "payment_agents" ADD CONSTRAINT "payment_agents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
