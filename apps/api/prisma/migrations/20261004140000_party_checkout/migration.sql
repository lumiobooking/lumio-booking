-- Party checkout: one sale may settle several floor tickets, and each line
-- remembers the ticket (and line) it came from and whose service it is.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "walkInIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "walkInId" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "walkInLineId" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "guestName" TEXT;
