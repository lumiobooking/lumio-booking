-- Lumio team notes on a salon: short reminders the setup/support team writes
-- for each other on the agency list. Internal — never shown to the salon.
CREATE TABLE IF NOT EXISTS "agency_notes" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "authorId" TEXT,
  "authorName" TEXT,
  "doneAt" TIMESTAMP(3),
  "doneBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agency_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "agency_notes_tenantId_doneAt_idx" ON "agency_notes"("tenantId", "doneAt");
DO $$ BEGIN
  ALTER TABLE "agency_notes" ADD CONSTRAINT "agency_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
