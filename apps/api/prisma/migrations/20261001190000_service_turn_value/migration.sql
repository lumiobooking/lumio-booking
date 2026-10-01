-- Walk-in turns a service is worth (1 normally, 0.5 for a small add-on, 0 = none).
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "turnValue" DOUBLE PRECISION NOT NULL DEFAULT 1;
