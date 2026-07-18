-- Walk-in mid-service review nudge (fired once) + per-customer rebooking reminder marker.
ALTER TABLE "walk_ins" ADD COLUMN IF NOT EXISTS "reviewReqSentAt" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "rebookRemindedAt" TIMESTAMP(3);
