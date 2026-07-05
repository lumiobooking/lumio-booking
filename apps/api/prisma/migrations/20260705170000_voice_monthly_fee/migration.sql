-- AI Hotline add-on monthly subscription fee (cents). 0 = bundled in the plan.
ALTER TABLE "voice_lines" ADD COLUMN "monthlyCents" INTEGER NOT NULL DEFAULT 0;
