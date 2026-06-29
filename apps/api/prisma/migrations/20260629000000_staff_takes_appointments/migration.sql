-- Bookable flag: whether a staff member shows in the booking page / calendar /
-- walk-in assignment / auto-assign engine. Idempotent: safe to re-run.
ALTER TABLE "staff_members"
  ADD COLUMN IF NOT EXISTS "takesAppointments" BOOLEAN NOT NULL DEFAULT true;

-- Existing front-desk / management staff should not appear as bookable
-- technicians. Technicians keep the default (true). Runs once meaningfully;
-- re-running is harmless (already-correct rows are unchanged).
UPDATE "staff_members"
  SET "takesAppointments" = false
  WHERE "staffRole" IN ('MANAGER', 'RECEPTIONIST');
