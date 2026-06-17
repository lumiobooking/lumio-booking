-- Super-admin manual access overrides for tenants.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billingExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "accessUntil" TIMESTAMP(3);
