-- Salon-managed chair types (add / rename / delete). Replaces the fixed enum for grouping.
CREATE TABLE "station_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "station_types_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "station_types_tenantId_idx" ON "station_types"("tenantId");
ALTER TABLE "station_types" ADD CONSTRAINT "station_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stations" ADD COLUMN "stationTypeId" TEXT;

-- Backfill: create one type per (tenant, kind) from existing chairs, then link them.
INSERT INTO "station_types" ("id", "tenantId", "name", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, d."tenantId",
  CASE d."kind" WHEN 'PEDI' THEN 'Pedi' WHEN 'MANI' THEN 'Mani' WHEN 'NAIL' THEN 'Nail' ELSE 'Other' END,
  CASE d."kind" WHEN 'PEDI' THEN 0 WHEN 'MANI' THEN 1 WHEN 'NAIL' THEN 2 ELSE 3 END,
  now(), now()
FROM (SELECT DISTINCT "tenantId", "kind" FROM "stations") d;

UPDATE "stations" st SET "stationTypeId" = t."id"
FROM "station_types" t
WHERE t."tenantId" = st."tenantId"
  AND t."name" = CASE st."kind" WHEN 'PEDI' THEN 'Pedi' WHEN 'MANI' THEN 'Mani' WHEN 'NAIL' THEN 'Nail' ELSE 'Other' END;

CREATE INDEX "stations_stationTypeId_idx" ON "stations"("stationTypeId");
ALTER TABLE "stations" ADD CONSTRAINT "stations_stationTypeId_fkey" FOREIGN KEY ("stationTypeId") REFERENCES "station_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
