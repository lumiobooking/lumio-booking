-- Admin-set booking-list priority for fair/curated technician ordering.
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "bookingPriority" INTEGER NOT NULL DEFAULT 0;
