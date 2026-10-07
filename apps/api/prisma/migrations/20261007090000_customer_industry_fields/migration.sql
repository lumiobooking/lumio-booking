-- Per-industry customer record (dental history, real-estate lead stage, dietary needs…).
-- Additive and idempotent: existing rows get an empty object.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "industryFields" JSONB NOT NULL DEFAULT '{}';
