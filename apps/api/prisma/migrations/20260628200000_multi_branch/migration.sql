-- Multi-branch / chain accounts. Each branch stays a fully isolated tenant; this
-- adds an owner "account group" layer + per-manager branch access. Idempotent.

CREATE TABLE IF NOT EXISTS "account_groups" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_groups_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "accountGroupId" TEXT;
ALTER TABLE "users"   ADD COLUMN IF NOT EXISTS "accountGroupId" TEXT;

CREATE INDEX IF NOT EXISTS "tenants_accountGroupId_idx" ON "tenants"("accountGroupId");
CREATE INDEX IF NOT EXISTS "users_accountGroupId_idx"   ON "users"("accountGroupId");

DO $$ BEGIN
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_accountGroupId_fkey"
    FOREIGN KEY ("accountGroupId") REFERENCES "account_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_accountGroupId_fkey"
    FOREIGN KEY ("accountGroupId") REFERENCES "account_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "branch_memberships" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "branch_memberships_userId_tenantId_key" ON "branch_memberships"("userId", "tenantId");
CREATE INDEX IF NOT EXISTS "branch_memberships_userId_idx"   ON "branch_memberships"("userId");
CREATE INDEX IF NOT EXISTS "branch_memberships_tenantId_idx" ON "branch_memberships"("tenantId");

DO $$ BEGIN
  ALTER TABLE "branch_memberships" ADD CONSTRAINT "branch_memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "branch_memberships" ADD CONSTRAINT "branch_memberships_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
