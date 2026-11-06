-- A service with no price is "priced at the salon"; one that really costs nothing is marked free.
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "isFree" BOOLEAN NOT NULL DEFAULT false;
