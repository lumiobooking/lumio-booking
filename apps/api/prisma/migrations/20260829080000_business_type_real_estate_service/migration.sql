-- The AI's identity follows the tenant's line of business. Two new trades:
-- REAL_ESTATE (lead capture + consultation) and SERVICE (generic local business).
ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'REAL_ESTATE';
ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'SERVICE';
