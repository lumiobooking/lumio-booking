-- Plan feature flag: unlocks the POS suite (POS / Products / Orders / Sales report).
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "posEnabled" BOOLEAN NOT NULL DEFAULT false;
