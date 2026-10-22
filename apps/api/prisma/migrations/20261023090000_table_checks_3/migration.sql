-- Restaurant table service, phase 3: table QR ordering, kitchen display,
-- held dishes, bank-feed matching and VAT invoice requests.
ALTER TABLE "restaurant_tables" ADD COLUMN IF NOT EXISTS "qrToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_tables_qrToken_key" ON "restaurant_tables"("qrToken");
ALTER TABLE "table_checks" ADD COLUMN IF NOT EXISTS "callReason" TEXT;
ALTER TABLE "table_checks" ADD COLUMN IF NOT EXISTS "callAt" TIMESTAMP(3);
ALTER TABLE "table_checks" ADD COLUMN IF NOT EXISTS "bankPaidCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "table_checks" ADD COLUMN IF NOT EXISTS "bankPaidAt" TIMESTAMP(3);
ALTER TABLE "table_checks" ADD COLUMN IF NOT EXISTS "bankRef" TEXT;
ALTER TABLE "table_checks" ADD COLUMN IF NOT EXISTS "invoiceInfo" JSONB;
ALTER TABLE "table_check_lines" ADD COLUMN IF NOT EXISTS "held" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "table_check_lines" ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3);
ALTER TABLE "table_check_lines" ADD COLUMN IF NOT EXISTS "source" TEXT;
