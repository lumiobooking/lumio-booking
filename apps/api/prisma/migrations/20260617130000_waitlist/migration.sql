-- Waitlist: customers waiting for a slot (fill gaps from cancellations).
-- Idempotent so it is safe to re-run on Render.
DO $$ BEGIN
  CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'CONVERTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "waitlist_entries" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "serviceId"     TEXT,
  "customerName"  TEXT NOT NULL,
  "phone"         TEXT,
  "email"         TEXT,
  "preferredDate" TEXT,
  "note"          TEXT,
  "status"        "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notifiedAt"    TIMESTAMP(3),
  CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "waitlist_entries_tenantId_idx" ON "waitlist_entries"("tenantId");
CREATE INDEX IF NOT EXISTS "waitlist_entries_tenantId_status_idx" ON "waitlist_entries"("tenantId", "status");

DO $$ BEGIN
  ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
