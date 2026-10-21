-- The owner's / manager's approval PIN for refunds and voids at the till.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approvalPinHash" TEXT;
