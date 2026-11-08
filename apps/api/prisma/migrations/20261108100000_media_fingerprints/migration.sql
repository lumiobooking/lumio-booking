-- Fingerprints of uploaded photos/clips, to catch one salon's media uploaded to another (8 Nov 2026).
CREATE TABLE IF NOT EXISTS "media_fingerprints" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "sha256" TEXT NOT NULL,
  "phash" TEXT,
  "kind" TEXT NOT NULL,
  "url" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_fingerprints_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "media_fingerprints_sha256_idx" ON "media_fingerprints"("sha256");
CREATE INDEX IF NOT EXISTS "media_fingerprints_tenantId_createdAt_idx" ON "media_fingerprints"("tenantId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "media_fingerprints" ADD CONSTRAINT "media_fingerprints_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
