-- Customer birthdate for the automated birthday campaign.
-- Idempotent: safe to run if the column already exists.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "birthDate" TIMESTAMP(3);
