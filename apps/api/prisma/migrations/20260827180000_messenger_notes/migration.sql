-- Internal notes on a conversation.
--
-- Staff write these for each other — "đã hẹn gọi lại 3h", "khách hỏi giá 3 lần
-- rồi" — and the customer must NEVER see them.
--
-- WHY A SEPARATE TABLE AND NOT A FLAG ON THE MESSAGE HISTORY
--
-- Because the one mistake an inbox cannot take back is sending a private remark
-- about a customer to that customer. If notes and messages share a list, that
-- mistake is one wrong branch away: a render that forgets the flag, a "resend
-- last message" that picks up the wrong row, a bug in a filter. Different table,
-- different endpoint, different colour on screen — three separate walls, none of
-- which a single mistake can cross.
--
-- Nothing here changes any existing behaviour: it is a new table, and a salon
-- that never writes a note never has a row in it.

CREATE TABLE "messenger_notes" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "threadId"   TEXT NOT NULL,
  -- Null once that staff account is removed. The note survives: it is the
  -- salon's knowledge about a customer, not the employee's property.
  "authorId"   TEXT,
  -- Captured at write time so a deleted account still reads sensibly.
  "authorName" TEXT NOT NULL,
  "text"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "messenger_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messenger_notes_tenantId_idx" ON "messenger_notes" ("tenantId");
CREATE INDEX "messenger_notes_threadId_createdAt_idx" ON "messenger_notes" ("threadId", "createdAt");

-- CASCADE from the tenant and the thread: a deleted salon or a deleted
-- conversation should not leave orphaned notes about a customer lying in the
-- database. SET NULL from the user, for the reason above.
ALTER TABLE "messenger_notes"
  ADD CONSTRAINT "messenger_notes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messenger_notes"
  ADD CONSTRAINT "messenger_notes_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "messenger_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messenger_notes"
  ADD CONSTRAINT "messenger_notes_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
