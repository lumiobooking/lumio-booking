-- Link a walk-in to a CRM customer (found/created by phone) so walk-ins earn
-- loyalty and become remarketable. Idempotent: safe to re-run.
ALTER TABLE "walk_ins" ADD COLUMN IF NOT EXISTS "customerId" TEXT;

CREATE INDEX IF NOT EXISTS "walk_ins_tenantId_customerId_idx"
  ON "walk_ins"("tenantId", "customerId");

DO $$ BEGIN
  ALTER TABLE "walk_ins"
    ADD CONSTRAINT "walk_ins_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
