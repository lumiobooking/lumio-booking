-- Cache the Facebook Page name on connect (additive, idempotent).
ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "pageName" TEXT;
