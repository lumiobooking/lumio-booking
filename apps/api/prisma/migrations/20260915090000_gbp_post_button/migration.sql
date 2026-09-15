-- The button on a Google Business Profile post. The writer picks Book / Call /
-- Learn more / none and may override the link; absent means the default a
-- post always had (Book, on the shop's own booking page). Google refuses a
-- Book button with no link, which is the failure this column exists to end.
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "google" JSONB;
