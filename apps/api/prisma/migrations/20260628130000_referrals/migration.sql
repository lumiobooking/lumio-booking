-- Referral program fields on customers. Idempotent: safe to re-run.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "referralRewardedAt" TIMESTAMP(3);

-- Unique referral code per tenant (NULLs are distinct in Postgres, so codeless customers don't conflict).
CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenantId_referralCode_key" ON "customers"("tenantId", "referralCode");
CREATE INDEX IF NOT EXISTS "customers_tenantId_referredById_idx" ON "customers"("tenantId", "referredById");

-- Self-relation FK: referredById -> customers(id), set null if the referrer is deleted.
DO $$ BEGIN
  ALTER TABLE "customers"
    ADD CONSTRAINT "customers_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
