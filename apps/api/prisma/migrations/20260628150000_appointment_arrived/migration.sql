-- Add the "ARRIVED" (checked-in) appointment status + arrivedAt timestamp so the
-- front desk can mark a customer as in the salon. Idempotent: safe to re-run.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'ARRIVED';

ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMP(3);
