-- Who on the Lumio team has which job of this week, and which are finished.
--
-- Shape: { "<jobId>": { "by": "linh@lumio.vn", "at": "2026-09-07T…", "done": true } }
-- Keyed by the job's stable id (see job-brief), for the same reason `ticks` is:
-- the generated plan is rewritten every hour and a positional key would move
-- a person's claim onto somebody else's job.
ALTER TABLE "content_weeks" ADD COLUMN IF NOT EXISTS "crew" JSONB;
