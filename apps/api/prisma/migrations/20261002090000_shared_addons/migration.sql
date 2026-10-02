-- Shared add-ons: an extra can belong to one service (as before), to every
-- service in a category, or to the whole menu ("Take Off $5").
ALTER TABLE "service_addons" ALTER COLUMN "serviceId" DROP NOT NULL;
ALTER TABLE "service_addons" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
DO $$ BEGIN
  ALTER TABLE "service_addons" ADD CONSTRAINT "service_addons_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "service_addons_categoryId_idx" ON "service_addons"("categoryId");
