-- rt200: invite links for the team, and "Đăng nhập với Facebook" per salon.
-- Every row carries tenantId; deleting a salon deletes its invites and logins.
CREATE TABLE IF NOT EXISTS "staff_invites" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "staffRole" "StaffRole" NOT NULL,
  "label" TEXT,
  "maxUses" INTEGER NOT NULL DEFAULT 1,
  "uses" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "staff_invites_tokenHash_key" ON "staff_invites"("tokenHash");
CREATE INDEX IF NOT EXISTS "staff_invites_tenantId_idx" ON "staff_invites"("tenantId");
DO $$ BEGIN
  ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "social_logins" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3),
  CONSTRAINT "social_logins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "social_logins_provider_providerUserId_tenantId_key" ON "social_logins"("provider", "providerUserId", "tenantId");
CREATE INDEX IF NOT EXISTS "social_logins_tenantId_idx" ON "social_logins"("tenantId");
CREATE INDEX IF NOT EXISTS "social_logins_userId_idx" ON "social_logins"("userId");
DO $$ BEGIN
  ALTER TABLE "social_logins" ADD CONSTRAINT "social_logins_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "social_logins" ADD CONSTRAINT "social_logins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
