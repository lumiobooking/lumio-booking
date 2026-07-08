-- Number of people per booking (group bookings)
ALTER TABLE "appointments" ADD COLUMN "partySize" INTEGER NOT NULL DEFAULT 1;
