-- Post-visit review request: fired once, mid-service, per appointment.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "reviewReqSentAt" TIMESTAMP(3);
