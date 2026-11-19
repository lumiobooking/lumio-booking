-- Thư viện ảnh gửi khách (19 Nov 2026): one salon's pictures for chat, chosen by labels.
CREATE TABLE IF NOT EXISTS "media_library" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "serviceId" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "aiAllowed" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "consent" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "source" TEXT NOT NULL DEFAULT 'upload',
  "priceSig" TEXT,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "lastSentAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_library_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "media_library_tenantId_kind_idx" ON "media_library"("tenantId", "kind");
CREATE INDEX IF NOT EXISTS "media_library_tenantId_url_idx" ON "media_library"("tenantId", "url");
DO $$ BEGIN
  ALTER TABLE "media_library" ADD CONSTRAINT "media_library_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
