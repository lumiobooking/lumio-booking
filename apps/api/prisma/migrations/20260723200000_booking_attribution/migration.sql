-- Booking attribution: utm_term + Google click ids + landing snapshot.
-- Additive + nullable — safe on live data, no backfill required.
-- NOTE: the Prisma model is `Appointment` but the physical table is mapped to
-- "appointments" (@@map) — always ALTER the mapped name.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "utmTerm" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "gclid" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "gbraid" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "wbraid" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "attrLandingUrl" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "attrReferrer" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "attrCapturedAt" TIMESTAMP(3);
