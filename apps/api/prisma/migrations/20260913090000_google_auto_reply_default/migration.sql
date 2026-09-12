-- Google review auto-reply: turn it on for everybody, once.
--
-- `approveFirst` has been stored on every salon that ever opened the Google
-- Reviews settings screen, and until now NOTHING IN THE CODE READ IT. So the
-- `true` sitting in those rows is not a decision anybody made — it is the old
-- default leaking into the database through a switch that did nothing. Leaving
-- it alone would mean the feature ships "on by default" and is off for exactly
-- the salons that have been using the product longest.
--
-- So: clear it once, everywhere. From here the field is live — a salon that
-- turns approval back on will have that respected, because from this release
-- the code actually reads it.
--
-- Idempotent: re-running changes nothing. Scoped to the one settings key.
UPDATE "Setting"
SET "value" = jsonb_set("value"::jsonb, '{approveFirst}', 'false'::jsonb, true)
WHERE "key" = 'googleReviews'
  AND ("value"::jsonb ->> 'approveFirst') IS DISTINCT FROM 'false';
