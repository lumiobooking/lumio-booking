-- Public pricing plans: Starter / Growth / Pro. Runs once on deploy and upserts
-- the three plans the website shows (GET /public/plans returns publicVisible rows).
-- Idempotent via ON CONFLICT so a pre-existing plan_pro is refreshed, not duplicated.
-- Prices in cents. Yearly = 10x monthly (2 months free). Limits null = unlimited.
INSERT INTO "plans" (
  "id","name","description","priceCents","currency","billingInterval",
  "priceMonthlyCents","priceYearlyCents","trialDays",
  "tagline","featuresJson","publicVisible","highlighted","sortOrder",
  "maxStaff","maxBookingsPerMonth","maxSmsPerMonth",
  "posEnabled","onlinePaymentEnabled","multiLocationEnabled","whiteLabelEnabled",
  "isActive","updatedAt"
) VALUES
(
  'plan_starter','Starter','New salon getting started',4900,'USD','MONTHLY',
  4900,49000,14,
  'For a new salon getting started',
  '["Unlimited staff — no per-tech fees","Online booking + reminders","Basic POS checkout","Loyalty points + Google review boost","Walk-in list","Keep your own card processor — no % on your sales","1 location"]'::jsonb,
  true,false,0,
  NULL,NULL,NULL,
  true,true,false,false,
  true,CURRENT_TIMESTAMP
),
(
  'plan_growth','Growth','Most popular — the full marketing engine',9900,'USD','MONTHLY',
  9900,99000,14,
  'Most popular — the full marketing engine',
  '["Everything in Starter","Full marketing: SMS/email, birthday, referral, weekday deals","Customer display + tipping","Walk-in queue with fair turn rotation","Payroll with tip tracking","Inventory + gift cards","Unlimited staff"]'::jsonb,
  true,true,1,
  NULL,NULL,NULL,
  true,true,false,false,
  true,CURRENT_TIMESTAMP
),
(
  'plan_pro','Pro','For chains & advanced',14900,'USD','MONTHLY',
  14900,149000,14,
  'For chains — per location, volume discounts',
  '["Everything in Growth","Multiple locations + consolidated reporting","Advanced payroll + tax export","Priority support + white-label","$149 per location · discount at 5+ · 10+ contact us"]'::jsonb,
  true,false,2,
  NULL,NULL,NULL,
  true,true,true,true,
  true,CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "name"=EXCLUDED."name",
  "description"=EXCLUDED."description",
  "priceCents"=EXCLUDED."priceCents",
  "currency"=EXCLUDED."currency",
  "priceMonthlyCents"=EXCLUDED."priceMonthlyCents",
  "priceYearlyCents"=EXCLUDED."priceYearlyCents",
  "trialDays"=EXCLUDED."trialDays",
  "tagline"=EXCLUDED."tagline",
  "featuresJson"=EXCLUDED."featuresJson",
  "publicVisible"=EXCLUDED."publicVisible",
  "highlighted"=EXCLUDED."highlighted",
  "sortOrder"=EXCLUDED."sortOrder",
  "posEnabled"=EXCLUDED."posEnabled",
  "onlinePaymentEnabled"=EXCLUDED."onlinePaymentEnabled",
  "multiLocationEnabled"=EXCLUDED."multiLocationEnabled",
  "whiteLabelEnabled"=EXCLUDED."whiteLabelEnabled",
  "isActive"=EXCLUDED."isActive",
  "updatedAt"=CURRENT_TIMESTAMP;

-- Hide any older demo plans (e.g. plan_basic) from the public pricing page.
-- (Does not deactivate them, so any tenant already on one keeps working.)
UPDATE "plans" SET "publicVisible" = false
WHERE "id" NOT IN ('plan_starter','plan_growth','plan_pro');
