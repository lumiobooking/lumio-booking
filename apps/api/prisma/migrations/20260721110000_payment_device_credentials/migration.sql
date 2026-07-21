-- Per-terminal credentials for multi-location salons.
-- iPOSpays issues one Auth Key per TPN, so each terminal can carry its own.
-- Additive and nullable: existing rows keep using the connection-level key.
ALTER TABLE "payment_devices" ADD COLUMN IF NOT EXISTS "credentialEnc" TEXT;
ALTER TABLE "payment_devices" ADD COLUMN IF NOT EXISTS "keyHint" TEXT;
