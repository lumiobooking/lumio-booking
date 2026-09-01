-- Trend snapshots: what is trending in a trade, pulled once a day.
--
-- One row per (scope, source, tenant). YouTube and Google rows are shared by
-- every salon in the same trade and market (tenantId NULL); Instagram rows are
-- per tenant, fetched with that tenant's own connected account.
--
-- Written by hand and idempotent, like the other migrations in this folder.

CREATE TABLE IF NOT EXISTS "trend_snapshots" (
  "id"        TEXT PRIMARY KEY,
  "key"       TEXT NOT NULL,
  "scope"     TEXT NOT NULL,
  "source"    TEXT NOT NULL,
  "tenantId"  TEXT,
  "items"     JSONB NOT NULL DEFAULT '[]',
  "fetchedAt" TIMESTAMP(3),
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "trend_snapshots"
    ADD CONSTRAINT "trend_snapshots_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "trend_snapshots_key_key" ON "trend_snapshots" ("key");
CREATE INDEX IF NOT EXISTS "trend_snapshots_tenantId_idx" ON "trend_snapshots" ("tenantId");
CREATE INDEX IF NOT EXISTS "trend_snapshots_scope_source_idx" ON "trend_snapshots" ("scope", "source");
