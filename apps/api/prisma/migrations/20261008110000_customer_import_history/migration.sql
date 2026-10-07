-- History brought over from a salon's previous system (spend, visits, last visit, source).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "importedSpentCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "importedVisits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "lastVisitAt" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "importSource" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "importedAt" TIMESTAMP(3);
