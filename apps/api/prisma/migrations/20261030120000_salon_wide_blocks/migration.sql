-- Temporary blocks from the Calendar. A block for ONE technician is an
-- approved time_off_requests row (as before); a block for the WHOLE SALON is
-- the same row with no technician. Existing rows are untouched, and the
-- (tenantId, status, startDate) index already serves the new reads.
ALTER TABLE "time_off_requests" ALTER COLUMN "staffId" DROP NOT NULL;
