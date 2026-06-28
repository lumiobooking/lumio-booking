-- Staff sub-role for feature permissions (RBAC). Idempotent: safe to re-run.
DO $$ BEGIN
  CREATE TYPE "StaffRole" AS ENUM ('MANAGER', 'RECEPTIONIST', 'TECHNICIAN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "staff_members"
  ADD COLUMN IF NOT EXISTS "staffRole" "StaffRole" NOT NULL DEFAULT 'TECHNICIAN';
