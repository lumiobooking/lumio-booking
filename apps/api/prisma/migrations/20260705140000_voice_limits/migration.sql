-- AI hotline plan limits per tenant. 0 = unlimited. Overage stored in cents.
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "includedMinutes"    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "includedSms"        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "overageCentsPerMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "overageCentsPerSms" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "hardCap"            BOOLEAN NOT NULL DEFAULT false;
