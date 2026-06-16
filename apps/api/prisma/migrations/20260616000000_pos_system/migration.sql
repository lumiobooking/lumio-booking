-- POS system: products, orders, order items, order payments + staff commission.
-- Written idempotently so it is safe to (re)apply.

-- Enums -------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'PAID', 'VOID', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrderItemKind" AS ENUM ('SERVICE', 'PRODUCT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Staff commission --------------------------------------------------------
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "commissionPercent" INTEGER NOT NULL DEFAULT 0;

-- Products ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "products" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "priceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "taxable" BOOLEAN NOT NULL DEFAULT true,
  "trackStock" BOOLEAN NOT NULL DEFAULT false,
  "stockQty" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "products_tenantId_idx" ON "products" ("tenantId");
CREATE INDEX IF NOT EXISTS "products_tenantId_isActive_idx" ON "products" ("tenantId", "isActive");

-- Orders ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "orders" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "orderNumber" INTEGER NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
  "customerId" TEXT,
  "appointmentId" TEXT,
  "createdByUserId" TEXT,
  "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents" INTEGER NOT NULL DEFAULT 0,
  "tipCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "paidCents" INTEGER NOT NULL DEFAULT 0,
  "changeCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "orders_tenantId_orderNumber_key" ON "orders" ("tenantId", "orderNumber");
CREATE INDEX IF NOT EXISTS "orders_tenantId_idx" ON "orders" ("tenantId");
CREATE INDEX IF NOT EXISTS "orders_tenantId_status_idx" ON "orders" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "orders_tenantId_createdAt_idx" ON "orders" ("tenantId", "createdAt");

-- Order items -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "order_items" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kind" "OrderItemKind" NOT NULL,
  "serviceId" TEXT,
  "productId" TEXT,
  "name" TEXT NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents" INTEGER NOT NULL DEFAULT 0,
  "tipCents" INTEGER NOT NULL DEFAULT 0,
  "lineTotalCents" INTEGER NOT NULL,
  "staffMemberId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "order_items_tenantId_idx" ON "order_items" ("tenantId");
CREATE INDEX IF NOT EXISTS "order_items_orderId_idx" ON "order_items" ("orderId");
CREATE INDEX IF NOT EXISTS "order_items_tenantId_staffMemberId_idx" ON "order_items" ("tenantId", "staffMemberId");

-- Order payments (tenders) ------------------------------------------------
CREATE TABLE IF NOT EXISTS "order_payments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "order_payments_tenantId_idx" ON "order_payments" ("tenantId");
CREATE INDEX IF NOT EXISTS "order_payments_orderId_idx" ON "order_payments" ("orderId");

-- Foreign keys (added guarded so re-apply won't fail) ---------------------
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
