-- Walk-in queue + fair turn rotation (nail-salon "lượt"). Idempotent for Render.
DO $$ BEGIN
  CREATE TYPE "WalkInStatus" AS ENUM ('WAITING', 'SERVING', 'DONE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "walk_ins" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "serviceId"       TEXT,
  "assignedStaffId" TEXT,
  "customerName"    TEXT,
  "phone"           TEXT,
  "note"            TEXT,
  "partySize"       INTEGER NOT NULL DEFAULT 1,
  "status"          "WalkInStatus" NOT NULL DEFAULT 'WAITING',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedAt"      TIMESTAMP(3),
  "doneAt"          TIMESTAMP(3),
  CONSTRAINT "walk_ins_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "walk_ins_tenantId_idx" ON "walk_ins"("tenantId");
CREATE INDEX IF NOT EXISTS "walk_ins_tenantId_status_idx" ON "walk_ins"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "walk_ins_tenantId_assignedStaffId_idx" ON "walk_ins"("tenantId", "assignedStaffId");

DO $$ BEGIN
  ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_assignedStaffId_fkey"
    FOREIGN KEY ("assignedStaffId") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
