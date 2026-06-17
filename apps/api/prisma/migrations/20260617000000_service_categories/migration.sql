-- Service menu categories + service grouping fields.

CREATE TABLE IF NOT EXISTS "service_categories" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "service_categories_tenantId_idx" ON "service_categories" ("tenantId");

DO $$ BEGIN
  ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "priceFrom" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "services_tenantId_categoryId_idx" ON "services" ("tenantId", "categoryId");

DO $$ BEGIN
  ALTER TABLE "services" ADD CONSTRAINT "services_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
