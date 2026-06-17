-- Review-reward program: feedback capture + staff reward points.

ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "rewardPoints" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "feedbacks" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "staffId" TEXT,
  "customerId" TEXT,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "invitedToGoogle" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "feedbacks_tenantId_idx" ON "feedbacks" ("tenantId");
CREATE INDEX IF NOT EXISTS "feedbacks_tenantId_staffId_idx" ON "feedbacks" ("tenantId", "staffId");

CREATE TABLE IF NOT EXISTS "staff_reward_transactions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_reward_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "staff_reward_transactions_tenantId_idx" ON "staff_reward_transactions" ("tenantId");
CREATE INDEX IF NOT EXISTS "staff_reward_transactions_tenantId_staffId_idx" ON "staff_reward_transactions" ("tenantId", "staffId");

DO $$ BEGIN
  ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "staff_reward_transactions" ADD CONSTRAINT "staff_reward_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "staff_reward_transactions" ADD CONSTRAINT "staff_reward_transactions_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
