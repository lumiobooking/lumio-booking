-- The light/dark choice follows the person, not the browser.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "theme" TEXT;
