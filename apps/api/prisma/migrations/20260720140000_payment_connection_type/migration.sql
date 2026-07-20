-- v2 architecture: connection type per device/intent (Cloud/USB/Bluetooth) + agent id.
-- Additive only. Existing rows default to CLOUD (current behavior).
ALTER TABLE "payment_devices" ADD COLUMN IF NOT EXISTS "connectionType" TEXT NOT NULL DEFAULT 'CLOUD';
ALTER TABLE "payment_devices" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "connectionType" TEXT;
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
