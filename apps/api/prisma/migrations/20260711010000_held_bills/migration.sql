-- Parked/held POS carts ("bill chờ").
CREATE TABLE "held_bills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT,
    "customerId" TEXT,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "held_bills_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "held_bills_tenantId_idx" ON "held_bills"("tenantId");
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
