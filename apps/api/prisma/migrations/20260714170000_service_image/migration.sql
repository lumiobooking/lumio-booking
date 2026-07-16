-- Optional per-service photo for the booking menu (hidden when null).
-- Table is mapped to "services" (Prisma @@map), not "Service".
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
