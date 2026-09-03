-- eSMS delivery callback: the SMSID that ties a notifications row to the
-- callback eSMS later sends, and the moment delivery was confirmed.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "notifications_providerMessageId_idx" ON "notifications"("providerMessageId");
