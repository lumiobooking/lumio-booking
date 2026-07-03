-- Add the linked Instagram business account id so IG DMs route to the tenant.
ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "igId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_connections_igId_key" ON "messenger_connections" ("igId");
