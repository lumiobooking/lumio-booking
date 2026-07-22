-- Track the customer's device (mobile/web) separately from the booking channel.
-- Additive + nullable: existing rows are untouched.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "device" TEXT;
