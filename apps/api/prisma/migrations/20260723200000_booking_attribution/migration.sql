-- Booking attribution: utm_term + Google click ids + landing snapshot.
-- Additive + nullable — safe on live data, no backfill required.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "utmTerm" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "gclid" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "gbraid" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "wbraid" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "attrLandingUrl" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "attrReferrer" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "attrCapturedAt" TIMESTAMP(3);
