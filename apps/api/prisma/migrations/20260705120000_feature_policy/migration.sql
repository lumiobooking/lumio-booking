-- Per-feature access policy on each tenant (Super Admin controlled).
-- { [featureKey]: 'salon' | 'platform' }. Idempotent for safe re-runs.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "featurePolicy" JSONB NOT NULL DEFAULT '{}';
