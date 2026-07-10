-- Typed chairs/stations for the reception floor view (Pedi / Mani / Nail).
CREATE TYPE "StationKind" AS ENUM ('PEDI', 'MANI', 'NAIL', 'OTHER');

CREATE TABLE "stations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StationKind" NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stations_tenantId_idx" ON "stations"("tenantId");
ALTER TABLE "stations" ADD CONSTRAINT "stations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "walk_ins" ADD COLUMN "stationId" TEXT;
CREATE INDEX "walk_ins_tenantId_stationId_idx" ON "walk_ins"("tenantId", "stationId");
ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
