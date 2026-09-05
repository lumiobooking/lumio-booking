-- How much of a salon one Lumio setup employee may see once inside it.
-- 'content' | 'setup' | 'full'; NULL reads as 'setup' in code (see
-- support-scope.ts levelOf) so the accounts that predate this column land on
-- the narrow level rather than the wide one.
-- Idempotent: safe to re-run on a database that already has the column.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supportLevel" TEXT;
