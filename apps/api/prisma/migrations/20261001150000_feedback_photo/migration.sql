-- A photo sent from the customer's phone while they answer on the shared screen.
ALTER TABLE "feedback_requests" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
