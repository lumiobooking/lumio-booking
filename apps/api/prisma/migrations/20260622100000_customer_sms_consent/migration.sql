-- A2P 10DLC: store explicit SMS marketing opt-in on the customer (idempotent).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "smsConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "smsConsentAt" TIMESTAMP(3);
