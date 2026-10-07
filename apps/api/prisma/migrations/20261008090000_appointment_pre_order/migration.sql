-- Restaurant reservations: dishes ordered ahead (informational; checked against the restaurant's own menu).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "preOrder" JSONB NOT NULL DEFAULT '[]';
