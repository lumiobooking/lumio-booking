-- Where an appointment happens when not at the business: a property to view (real estate) or a client's address (home services).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "location" TEXT;
