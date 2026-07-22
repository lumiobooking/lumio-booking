-- Social/ads channel API connections (BYO encrypted credentials). Additive.
CREATE TABLE IF NOT EXISTS "marketing_channel_connections" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "externalAccountId" TEXT,
  "accountName" TEXT,
  "credentialEnc" TEXT,
  "keyHint" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastSyncedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_channel_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_channel_connections_tenantId_platform_key" ON "marketing_channel_connections"("tenantId","platform");
CREATE INDEX IF NOT EXISTS "marketing_channel_connections_tenantId_idx" ON "marketing_channel_connections"("tenantId");
ALTER TABLE "marketing_channel_connections" ADD CONSTRAINT "marketing_channel_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
