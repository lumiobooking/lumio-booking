-- Walk-in tickets gain an optional "extra time" the front desk can set when a
-- customer asks for more while they are already in the chair. Nullable so every
-- existing row is untouched; IF NOT EXISTS so a re-run is harmless.
ALTER TABLE "walk_ins" ADD COLUMN IF NOT EXISTS "extraMinutes" INTEGER;
