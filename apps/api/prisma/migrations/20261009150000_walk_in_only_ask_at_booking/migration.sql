-- Booking policy per menu line:
--   services.walkInOnly      — first come, first served; never an appointment.
--   service_addons.askAtBooking — "Design?" must be asked before a booking is made.
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "walkInOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "service_addons" ADD COLUMN IF NOT EXISTS "askAtBooking" BOOLEAN NOT NULL DEFAULT false;
