-- One-touch printer setup: shop computers that print, and which took a ticket.
CREATE TABLE IF NOT EXISTS "print_devices" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "tokenHash" TEXT,
  "pairHash" TEXT,
  "pairExpiresAt" TIMESTAMP(3),
  "pairedAt" TIMESTAMP(3),
  "printers" JSONB NOT NULL DEFAULT '[]',
  "defaultPrinter" TEXT,
  "routes" JSONB NOT NULL DEFAULT '{}',
  "agentVersion" TEXT,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "print_devices_tokenHash_key" ON "print_devices"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "print_devices_pairHash_key" ON "print_devices"("pairHash");
CREATE INDEX IF NOT EXISTS "print_devices_tenantId_idx" ON "print_devices"("tenantId");
DO $$ BEGIN
  ALTER TABLE "print_devices" ADD CONSTRAINT "print_devices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "print_jobs" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
ALTER TABLE "print_jobs" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);
ALTER TABLE "print_jobs" ADD COLUMN IF NOT EXISTS "route" TEXT;
