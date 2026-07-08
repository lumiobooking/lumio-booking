-- Restaurant vertical: business type on tenant + tables + reservation table link
CREATE TYPE "BusinessType" AS ENUM ('SALON', 'RESTAURANT');
ALTER TABLE "tenants" ADD COLUMN "businessType" "BusinessType" NOT NULL DEFAULT 'SALON';

CREATE TABLE "restaurant_tables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 2,
    "area" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "restaurant_tables_tenantId_idx" ON "restaurant_tables"("tenantId");
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD COLUMN "tableId" TEXT;
CREATE INDEX "appointments_tenantId_tableId_startTime_idx" ON "appointments"("tenantId", "tableId", "startTime");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
