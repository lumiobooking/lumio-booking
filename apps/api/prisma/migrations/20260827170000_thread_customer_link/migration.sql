-- Link a conversation to the salon's customer record.
--
-- WHY IT IS STAMPED AT BOOKING TIME AND NOT GUESSED
--
-- A Messenger thread is identified by a page-scoped id: an opaque string Meta
-- gives us for this person on this page. It matches nothing in the salon's own
-- data. The one moment where that id and a real customer are provably the same
-- human is when a booking is made from the conversation — a name and a phone
-- number were given, and a Customer row came back.
--
-- Everything else is a guess. Matching on display name would confidently attach
-- one Nguyen Thi Huong's chat to a different Nguyen Thi Huong's spending
-- history, and the inbox would show her someone else's appointments. Null and
-- an empty panel is the honest answer until we actually know.
--
-- ON DELETE SET NULL: deleting a customer record must not delete the
-- conversation. The messages happened.

ALTER TABLE "messenger_threads" ADD COLUMN "customerId" TEXT;

ALTER TABLE "messenger_threads"
  ADD CONSTRAINT "messenger_threads_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "messenger_threads_customerId_idx" ON "messenger_threads" ("customerId");
