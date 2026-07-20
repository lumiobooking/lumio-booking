-- POS Payment Hub (Phase 1). ADDITIVE ONLY: 5 new tables, zero changes to existing tables.

CREATE TABLE IF NOT EXISTS "payment_connections" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "label" TEXT,
  "credentialEnc" TEXT,
  "keyHint" TEXT,
  "externalAccountId" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "capabilities" JSONB NOT NULL DEFAULT '{}',
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_connections_tenantId_provider_key" ON "payment_connections"("tenantId","provider");
CREATE INDEX IF NOT EXISTS "payment_connections_tenantId_idx" ON "payment_connections"("tenantId");

CREATE TABLE IF NOT EXISTS "payment_devices" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalReaderId" TEXT NOT NULL,
  "label" TEXT,
  "locationId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_devices_tenantId_provider_externalReaderId_key" ON "payment_devices"("tenantId","provider","externalReaderId");
CREATE INDEX IF NOT EXISTS "payment_devices_tenantId_idx" ON "payment_devices"("tenantId");
CREATE INDEX IF NOT EXISTS "payment_devices_connectionId_idx" ON "payment_devices"("connectionId");

CREATE TABLE IF NOT EXISTS "payment_intents" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "connectionId" TEXT,
  "provider" TEXT NOT NULL,
  "externalIntentId" TEXT,
  "orderId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'REQUIRES_PAYMENT',
  "deviceId" TEXT,
  "clientRef" TEXT,
  "captureMethod" TEXT NOT NULL DEFAULT 'automatic',
  "lastError" TEXT,
  "providerRaw" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "succeededAt" TIMESTAMP(3),
  CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_tenantId_clientRef_key" ON "payment_intents"("tenantId","clientRef");
CREATE INDEX IF NOT EXISTS "payment_intents_tenantId_idx" ON "payment_intents"("tenantId");
CREATE INDEX IF NOT EXISTS "payment_intents_tenantId_status_idx" ON "payment_intents"("tenantId","status");
CREATE INDEX IF NOT EXISTS "payment_intents_orderId_idx" ON "payment_intents"("orderId");

CREATE TABLE IF NOT EXISTS "payment_refunds" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalRefundId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdByUserId" TEXT,
  "providerRaw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "payment_refunds_tenantId_idx" ON "payment_refunds"("tenantId");
CREATE INDEX IF NOT EXISTS "payment_refunds_intentId_idx" ON "payment_refunds"("intentId");

CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "provider" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "type" TEXT,
  "payload" JSONB,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_webhook_events_provider_externalEventId_key" ON "payment_webhook_events"("provider","externalEventId");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_tenantId_idx" ON "payment_webhook_events"("tenantId");

-- Foreign keys (added after tables exist).
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_devices" ADD CONSTRAINT "payment_devices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_devices" ADD CONSTRAINT "payment_devices_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "payment_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "payment_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
