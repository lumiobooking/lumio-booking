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
-- WHY THE GUARD.
--
-- The first version of this was a bare UPDATE, and it took the API deploy down
-- with `relation "Setting" does not exist`. Postgres parses a top-level
-- statement before it runs, so a missing table is a hard error at parse time
-- even inside a transaction that would never have touched a row.
--
-- That is the wrong failure mode for a DATA migration. This one changes no
-- schema and nothing depends on it; a database where the table is not there
-- yet has nothing to back-fill, and the correct behaviour is to do nothing and
-- let the deploy continue. Inside a DO block the table name is resolved at
-- RUN time, so the IF EXISTS genuinely protects it.
--
-- Idempotent: re-running changes nothing. Scoped to the one settings key.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'Setting'
  ) THEN
    UPDATE "Setting"
    SET "value" = jsonb_set("value"::jsonb, '{approveFirst}', 'false'::jsonb, true)
    WHERE "key" = 'googleReviews'
      AND ("value"::jsonb ->> 'approveFirst') IS DISTINCT FROM 'false';
  END IF;
END $$;
