-- Which market a salon trades in: US | CA | VN.
--
-- DEFAULT 'US' is the whole safety argument. Every row that already exists gets
-- 'US', and the US preset is asserted in markets.spec.ts to be byte-for-byte
-- the defaults the system already ships — so this migration changes the
-- behaviour of exactly zero live salons.
--
-- Deliberately a plain text column rather than an enum: adding a market later
-- should be one line in markets.ts, not a database migration, and an
-- unrecognised value already resolves to US in code.
ALTER TABLE "tenants" ADD COLUMN "market" TEXT NOT NULL DEFAULT 'US';

-- Backfill the salons that were already telling us where they are. Vietnamese
-- timezone is unambiguous, so those rows are corrected rather than left as US.
UPDATE "tenants" SET "market" = 'VN'
 WHERE "timezone" IN ('Asia/Ho_Chi_Minh', 'Asia/Saigon');

UPDATE "tenants" SET "market" = 'CA'
 WHERE "timezone" IN ('America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax');
