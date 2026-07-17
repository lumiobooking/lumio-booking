-- Per-tenant plan-feature override (Super Admin can grant/deny features regardless of plan).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "featureOverrides" JSONB NOT NULL DEFAULT '{}';
