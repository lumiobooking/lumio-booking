-- When a MESSAGE last happened in a conversation.
--
-- WHY updatedAt COULD NOT DO THIS JOB
--
-- The inbox sorted by updatedAt, and Prisma moves updatedAt on EVERY write to
-- the row — including marking it read, taking it over, closing it, and
-- backfilling the customer's name. So simply clicking a conversation wrote
-- readAt, which moved updatedAt, which jumped that conversation to the top of
-- the list. The order rearranged itself under the hand of the person working
-- down it, and the thing at the top was whatever they had touched last rather
-- than whatever the customer had said last.
--
-- Meta's own inbox orders by the last message. So does every other chat tool.
-- This column is that: written only when a message is actually added to the
-- history, by the customer, the bot, or a member of staff.
--
-- Backfilled from updatedAt so existing conversations keep roughly the order
-- they have now rather than all collapsing to the bottom. It is an
-- approximation for old rows and exact for every row from here on.

ALTER TABLE "messenger_threads" ADD COLUMN "lastMessageAt" TIMESTAMP(3);

UPDATE "messenger_threads" SET "lastMessageAt" = "updatedAt" WHERE "lastMessageAt" IS NULL;

-- The inbox's main query: this salon's conversations, most recent message first.
CREATE INDEX "messenger_threads_tenantId_lastMessageAt_idx"
  ON "messenger_threads" ("tenantId", "lastMessageAt" DESC);
