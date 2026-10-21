-- What came off which line of a refunded bill (POS › Orders › Refund), so
-- technicians' sales, tips and commission follow a part refund.
CREATE TABLE IF NOT EXISTS "order_refunds" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "lines" JSONB NOT NULL DEFAULT '[]',
  "full" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_refunds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "order_refunds_tenantId_createdAt_idx" ON "order_refunds"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "order_refunds_tenantId_orderId_idx" ON "order_refunds"("tenantId", "orderId");
