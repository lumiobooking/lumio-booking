-- Promo code carried by a booking that came from a campaign link.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "offerCode" TEXT;
CREATE INDEX IF NOT EXISTS "appointments_tenantId_offerCode_idx" ON "appointments" ("tenantId", "offerCode");
