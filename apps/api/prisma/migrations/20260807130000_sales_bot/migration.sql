-- Sales mode for the agency's own Messenger page + captured leads.
ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "botMode" TEXT NOT NULL DEFAULT 'booking';
ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "leadEmail" TEXT;

CREATE TABLE IF NOT EXISTS "sales_leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "threadId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "salonName" TEXT,
    "city" TEXT,
    "interest" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_leads_tenantId_status_idx" ON "sales_leads"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "sales_leads_tenantId_phone_idx" ON "sales_leads"("tenantId", "phone");

ALTER TABLE "sales_leads" DROP CONSTRAINT IF EXISTS "sales_leads_tenantId_fkey";
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
