-- Optional fixed base pay per technician (cents/pay period), added on top of
-- commission + tips in payroll. Idempotent: safe to re-run.
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "baseCents" INTEGER NOT NULL DEFAULT 0;
