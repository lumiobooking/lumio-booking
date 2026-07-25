-- Dish photo for restaurant menu items (additive, idempotent).
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
