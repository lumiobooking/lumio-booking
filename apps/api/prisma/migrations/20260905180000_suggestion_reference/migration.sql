-- The reference the shop is meant to look at, separated from the feed the team
-- reads. One clip a staff member picked IS the brief and may be shown; the
-- hashtag feed it came off is the method and never leaves the team's side.
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "refUrl" TEXT;
ALTER TABLE "content_suggestions" ADD COLUMN IF NOT EXISTS "refThumbUrl" TEXT;
