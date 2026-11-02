-- Extra working hours for one technician on one day ("mở lịch lại" from the
-- Calendar). New table only; nothing existing changes.
CREATE TABLE "staff_extra_hours" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_extra_hours_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_extra_hours_tenantId_day_idx" ON "staff_extra_hours"("tenantId", "day");
CREATE INDEX "staff_extra_hours_tenantId_staffId_day_idx" ON "staff_extra_hours"("tenantId", "staffId", "day");

ALTER TABLE "staff_extra_hours" ADD CONSTRAINT "staff_extra_hours_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_extra_hours" ADD CONSTRAINT "staff_extra_hours_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
