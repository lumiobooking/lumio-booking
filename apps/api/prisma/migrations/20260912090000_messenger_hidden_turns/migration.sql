-- Messages the salon has hidden from a conversation view in Lumio.
--
-- NOT a delete: Meta has no API to unsend what a Page has already sent, so the
-- message stays in the customer's Messenger and in the Page inbox. This column
-- only stops Lumio drawing it in the transcript.
--
-- Existing rows get an empty array, so every conversation that exists today
-- renders byte-for-byte what it renders now.
ALTER TABLE "messenger_threads"
  ADD COLUMN "hiddenTurns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
