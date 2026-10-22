-- Restaurant table service, phase 2: sold-out dishes, dish options, merge /
-- split / pay-request markers on a bill.
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "soldOutAt" TIMESTAMP(3);
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "options" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "table_checks" ADD COLUMN IF NOT EXISTS "payRequestedAt" TIMESTAMP(3);
ALTER TABLE "table_checks" ADD COLUMN IF NOT EXISTS "mergedInto" TEXT;
ALTER TABLE "table_checks" ADD COLUMN IF NOT EXISTS "splitFrom" TEXT;
ALTER TABLE "table_check_lines" ADD COLUMN IF NOT EXISTS "options" JSONB NOT NULL DEFAULT '[]';
