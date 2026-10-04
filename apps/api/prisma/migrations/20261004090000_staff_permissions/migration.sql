-- Per-person permissions: the owner can widen or narrow what one staff member
-- may open, starting from their role's preset. Null keeps the preset, so every
-- existing account behaves exactly as before.
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "permissions" JSONB;
