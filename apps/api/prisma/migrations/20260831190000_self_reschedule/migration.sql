-- How many times the CUSTOMER moved this appointment themselves (Messenger /
-- AI hotline). Staff reschedules do not count: once written, the two look
-- identical, and only one of them should spend the self-service allowance.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "selfRescheduleCount" INTEGER NOT NULL DEFAULT 0;
