-- Denormalized sale channel for accurate source reporting.
ALTER TABLE "orders" ADD COLUMN "walkInId" TEXT;
ALTER TABLE "orders" ADD COLUMN "source" TEXT;

-- Backfill from the linked appointment's raw source, normalized to canonical channels.
UPDATE "orders" o SET "source" = CASE lower(a."source")
    WHEN 'web' THEN 'online'
    WHEN 'mobile' THEN 'online'
    WHEN 'online' THEN 'online'
    WHEN 'hotline' THEN 'hotline'
    WHEN 'messenger' THEN 'messenger'
    WHEN 'admin' THEN 'staff'
    WHEN 'staff' THEN 'staff'
    ELSE 'online' END
FROM "appointments" a
WHERE o."appointmentId" = a."id" AND a."source" IS NOT NULL;

-- Every non-appointment sale is an in-person counter/walk-in sale.
UPDATE "orders" SET "source" = 'walkin' WHERE "source" IS NULL AND "appointmentId" IS NULL;

CREATE INDEX "orders_tenantId_source_idx" ON "orders"("tenantId", "source");
