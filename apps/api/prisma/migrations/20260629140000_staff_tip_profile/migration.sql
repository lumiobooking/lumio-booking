-- Direct-tipping profile per technician: an uploaded payment QR image and an
-- optional handle/link (Venmo / Zelle / Cash App / PayPal). Idempotent.
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "tipQrUrl" TEXT;
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "tipHandle" TEXT;
