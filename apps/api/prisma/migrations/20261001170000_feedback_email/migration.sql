-- Email follow-up for the "how was your visit?" ask.
ALTER TABLE "feedback_requests" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "feedback_requests" ADD COLUMN IF NOT EXISTS "emailSentAt" TIMESTAMP(3);
