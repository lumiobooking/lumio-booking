-- Self-serve billing: plan pricing/marketing/provider IDs + subscription provider fields.

-- TenantStatus.PENDING (new enum value). IF NOT EXISTS makes this idempotent;
-- must NOT be inside a DO/transaction subblock.
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'PENDING';

-- Plan: pricing + marketing + external billing references.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "priceMonthlyCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "priceYearlyCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "trialDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "tagline" TEXT;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "featuresJson" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "publicVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "highlighted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripePriceMonthlyId" TEXT;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripePriceYearlyId" TEXT;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "paypalPlanMonthlyId" TEXT;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "paypalPlanYearlyId" TEXT;

-- Subscription: provider, interval, trial, external refs.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "externalCustomerId" TEXT;

-- Unique index on externalReference (provider subscription id) for webhook lookups.
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_externalReference_key" ON "subscriptions" ("externalReference");
