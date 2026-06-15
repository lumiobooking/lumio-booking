-- Per-service promotional discount (percent off, shown to customers).
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "discountPercent" INTEGER NOT NULL DEFAULT 0;
