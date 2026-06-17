-- Platform-level key/value config (Super Admin payment gateway keys, etc.)
CREATE TABLE IF NOT EXISTS "platform_config" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_config_pkey" PRIMARY KEY ("key")
);
