-- Barcode scanning + gift cards. Idempotent: safe to re-run on Render.

-- 1) Product barcode (scannable UPC), unique per tenant (NULLs allowed/ignored).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "products_tenantId_barcode_key" ON "products"("tenantId", "barcode");

-- 2) Gift card applied to an order (redemption record on the ticket).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "giftCardCode" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "giftCardAppliedCents" INTEGER NOT NULL DEFAULT 0;

-- 3) Gift card status enum.
DO $$ BEGIN
  CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) Gift cards.
CREATE TABLE IF NOT EXISTS "gift_cards" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "code"             TEXT NOT NULL,
  "initialCents"     INTEGER NOT NULL,
  "balanceCents"     INTEGER NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'USD',
  "status"           "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
  "purchaserName"    TEXT,
  "recipientName"    TEXT,
  "recipientContact" TEXT,
  "note"             TEXT,
  "expiresAt"        TIMESTAMP(3),
  "createdByUserId"  TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "gift_cards_tenantId_code_key" ON "gift_cards"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "gift_cards_tenantId_idx" ON "gift_cards"("tenantId");
CREATE INDEX IF NOT EXISTS "gift_cards_tenantId_status_idx" ON "gift_cards"("tenantId", "status");

DO $$ BEGIN
  ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Gift card transaction ledger.
CREATE TABLE IF NOT EXISTS "gift_card_transactions" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "giftCardId"      TEXT NOT NULL,
  "kind"            TEXT NOT NULL,
  "amountCents"     INTEGER NOT NULL,
  "orderId"         TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gift_card_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "gift_card_transactions_tenantId_idx" ON "gift_card_transactions"("tenantId");
CREATE INDEX IF NOT EXISTS "gift_card_transactions_giftCardId_idx" ON "gift_card_transactions"("giftCardId");

DO $$ BEGIN
  ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_giftCardId_fkey"
    FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
