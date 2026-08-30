-- Who cancelled a booking: customer / staff (+name) / ai.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "cancelledByName" TEXT;
