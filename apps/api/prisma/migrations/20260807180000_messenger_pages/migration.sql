-- One tenant, many Facebook pages. Brain stays on messenger_connections;
-- pages live here. Backfilled from existing connections so nothing breaks.
CREATE TABLE IF NOT EXISTS "messenger_pages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "igId" TEXT,
    "pageToken" TEXT NOT NULL,
    "pageName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messenger_pages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_pages_pageId_key" ON "messenger_pages"("pageId");
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_pages_igId_key" ON "messenger_pages"("igId");
CREATE INDEX IF NOT EXISTS "messenger_pages_tenantId_idx" ON "messenger_pages"("tenantId");
ALTER TABLE "messenger_pages" DROP CONSTRAINT IF EXISTS "messenger_pages_tenantId_fkey";
ALTER TABLE "messenger_pages" ADD CONSTRAINT "messenger_pages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "messenger_pages" ("id","tenantId","pageId","igId","pageToken","pageName","enabled")
SELECT gen_random_uuid()::text, mc."tenantId", mc."pageId", mc."igId", mc."pageToken", mc."pageName", mc."enabled"
FROM "messenger_connections" mc
WHERE mc."pageId" <> '' AND mc."pageToken" <> ''
  AND NOT EXISTS (SELECT 1 FROM "messenger_pages" mp WHERE mp."pageId" = mc."pageId");
