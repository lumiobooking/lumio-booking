-- Consolidate pricing to the 3 tiers: Starter $29 · Pro $69 · Premium $149.
-- Keyed on the current monthly price so it maps the existing rows without
-- touching plan IDs (tenants keep their FK). Idempotent + safe to re-run:
-- rows already at the new prices simply re-receive the same values.

-- Basic ($29) -> Starter ($29): booking essentials, no POS.
UPDATE "plans" SET
  "name" = 'Starter', "tagline" = 'Small & new salons',
  "priceMonthlyCents" = 2900, "priceYearlyCents" = 29000, "priceCents" = 2900,
  "trialDays" = 14, "highlighted" = false, "publicVisible" = true, "isActive" = true, "sortOrder" = 1,
  "posEnabled" = false, "onlinePaymentEnabled" = true, "multiLocationEnabled" = false, "whiteLabelEnabled" = false,
  "maxSmsPerMonth" = 100,
  "featuresJson" = '["Online booking 24/7","Calendar & customer CRM","Email confirmations","Google review QR","Installable app (PWA)","100 SMS / month"]'::jsonb
WHERE "priceMonthlyCents" = 2900;

-- Starter ($49) -> Pro ($69): full salon operations. Most popular.
UPDATE "plans" SET
  "name" = 'Pro', "tagline" = 'Full-service salons',
  "priceMonthlyCents" = 6900, "priceYearlyCents" = 69000, "priceCents" = 6900,
  "trialDays" = 14, "highlighted" = true, "publicVisible" = true, "isActive" = true, "sortOrder" = 2,
  "posEnabled" = true, "onlinePaymentEnabled" = true, "multiLocationEnabled" = false, "whiteLabelEnabled" = false,
  "maxSmsPerMonth" = 500,
  "featuresJson" = '["Everything in Starter","POS & checkout","Walk-ins & waitlist","Payroll & tips","Messenger AI booking bot","Marketing & referrals","500 SMS/mo · AI Hotline add-on"]'::jsonb
WHERE "priceMonthlyCents" = 4900;

-- Growth ($99) -> hidden (we keep only 3 public tiers). Row + FKs preserved.
UPDATE "plans" SET "publicVisible" = false, "isActive" = false
WHERE "priceMonthlyCents" = 9900;

-- Pro ($149) -> Premium ($149): multi-location + full AI.
UPDATE "plans" SET
  "name" = 'Premium', "tagline" = 'Multi-location + full AI',
  "priceMonthlyCents" = 14900, "priceYearlyCents" = 149000, "priceCents" = 14900,
  "trialDays" = 14, "highlighted" = false, "publicVisible" = true, "isActive" = true, "sortOrder" = 3,
  "posEnabled" = true, "onlinePaymentEnabled" = true, "multiLocationEnabled" = true, "whiteLabelEnabled" = true,
  "maxSmsPerMonth" = 1500,
  "featuresJson" = '["Everything in Pro","AI Hotline included (300 min)","Multi-branch + reports","Priority support","White-label ready","1,500 SMS / month"]'::jsonb
WHERE "priceMonthlyCents" = 14900;
