-- Ticks on the week's working sheets: { [jobId]: [stepIndex, ...] }.
-- Keyed by the job's stable id (see src/content/job-brief.ts), so a tick
-- survives the hourly regeneration of the generated plan.
ALTER TABLE "content_weeks" ADD COLUMN IF NOT EXISTS "ticks" JSONB;
