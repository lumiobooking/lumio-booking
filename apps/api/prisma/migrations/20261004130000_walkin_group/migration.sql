-- A party on the floor: tickets that came in together share one groupId
-- (the booking's groupId at check-in, or one minted at the desk). Null for
-- everyone who came alone, so nothing changes for existing tickets.
ALTER TABLE "walk_ins" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
CREATE INDEX IF NOT EXISTS "walk_ins_tenantId_groupId_idx" ON "walk_ins"("tenantId", "groupId");
