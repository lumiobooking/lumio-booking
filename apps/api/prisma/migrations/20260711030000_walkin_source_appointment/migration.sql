-- Unified floor: tag each walk-in by source; link a checked-in online booking.
ALTER TABLE "walk_ins" ADD COLUMN "source" TEXT;
ALTER TABLE "walk_ins" ADD COLUMN "appointmentId" TEXT;
UPDATE "walk_ins" SET "source" = 'walkin' WHERE "source" IS NULL;
CREATE INDEX "walk_ins_tenantId_appointmentId_idx" ON "walk_ins"("tenantId", "appointmentId");
