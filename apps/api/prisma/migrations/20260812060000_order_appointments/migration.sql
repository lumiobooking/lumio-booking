-- One ticket can settle a whole party (idempotent).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "appointmentIds" TEXT[] NOT NULL DEFAULT '{}';
-- Backfill so existing orders answer "which appointments did this pay for?"
-- the same way new ones do.
UPDATE "orders" SET "appointmentIds" = ARRAY["appointmentId"]
 WHERE "appointmentId" IS NOT NULL AND cardinality("appointmentIds") = 0;
