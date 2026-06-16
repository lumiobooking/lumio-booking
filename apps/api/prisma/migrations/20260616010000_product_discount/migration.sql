-- Per-product promotional discount (percent off, shown on the POS ticket/receipt).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "discountPercent" INTEGER NOT NULL DEFAULT 0;
