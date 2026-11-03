-- A service deleted while past bookings still point at it is archived, not removed.
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
