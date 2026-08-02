-- Recycle bin: deletions are snapshotted for a grace period before they become
-- permanent. IF NOT EXISTS everywhere so a re-run is harmless.
CREATE TABLE IF NOT EXISTS "trash_items" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "entity"          TEXT NOT NULL,
  "entityId"        TEXT NOT NULL,
  "label"           TEXT NOT NULL,
  "snapshot"        JSONB NOT NULL,
  "deletedByUserId" TEXT,
  "deletedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "restoredAt"      TIMESTAMP(3),
  CONSTRAINT "trash_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trash_items_tenantId_entity_deletedAt_idx"
  ON "trash_items"("tenantId", "entity", "deletedAt");
CREATE INDEX IF NOT EXISTS "trash_items_expiresAt_idx"
  ON "trash_items"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "trash_items"
    ADD CONSTRAINT "trash_items_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
