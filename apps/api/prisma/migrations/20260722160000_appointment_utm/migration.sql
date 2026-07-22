-- Campaign attribution (UTM) on bookings. Additive + nullable.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "utmSource" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "utmMedium" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "utmContent" TEXT;
