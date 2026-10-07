-- Chấm công: technicians' clock-in / clock-out, per salon.
CREATE TABLE IF NOT EXISTS "time_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'app',
    "note" TEXT,
    "createdByUserId" TEXT,
    "editedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "time_entries_tenantId_staffId_clockIn_idx" ON "time_entries"("tenantId", "staffId", "clockIn");
CREATE INDEX IF NOT EXISTS "time_entries_tenantId_clockIn_idx" ON "time_entries"("tenantId", "clockIn");
DO $$ BEGIN
  ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
