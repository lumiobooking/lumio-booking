-- Per-employee screen list for Lumio SUPPORT accounts.
--
-- WHY THE GUARD, AND WHY IT IS A DO BLOCK
--
-- Postgres parses every top-level statement in a migration before running any
-- of them, so a bare ALTER TABLE naming a table this database has not created
-- yet fails at parse time and takes the whole deploy down — which is exactly
-- how the 13/09 build died. Inside a DO block the name is resolved by PL/pgSQL
-- at run time, so the IF EXISTS is reached and the migration is a no-op on a
-- database that has no users table (a fresh one built by an earlier migration
-- in the same run, or a shadow database).
--
-- ADD COLUMN IF NOT EXISTS on top of that makes it idempotent, so re-running it
-- after a `migrate resolve --rolled-back` succeeds instead of erroring.
--
-- The default is an EMPTY array, and empty means "use the level's preset".
-- Every row that exists today therefore keeps exactly the access it has now:
-- this migration changes nobody's permissions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = current_schema() AND table_name = 'users') THEN
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supportCaps" TEXT[] NOT NULL DEFAULT '{}';
  END IF;
END $$;
