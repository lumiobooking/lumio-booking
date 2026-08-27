-- Ownership of a conversation: who has the floor, and whether it expires.
--
-- WHY
--
-- There was one boolean, "handoff", meaning "a human is here". It could not
-- tell apart a GUESS (a reply appeared in the Meta inbox that we did not send —
-- that person may have answered once and walked away) from a DECISION (someone
-- pressed Take over). Both expired after fifteen minutes, so pressing Take over
-- bought fifteen minutes and then the bot spoke over the human anyway. It
-- contradicted a salesperson mid-pitch in front of a customer.
--
-- WHY THIS MIGRATION IS SAFE FOR THE 25 LIVE SALONS
--
-- Every column is either nullable or defaulted to the value that reproduces
-- today's behaviour exactly:
--
--   handoffMode 'auto'  = the expiring kind, which is what every existing row
--                         already does. Nothing changes until someone locks a
--                         thread on purpose.
--   assignedUserId NULL = nobody in particular, the bot's case and every row
--                         that exists today.
--   status 'open'       = threads are open; closing is a new, human act.
--   lastCustomerAt NULL = unknown, and the code treats unknown as "no timer"
--                         rather than inventing one.
--   readAt NULL         = unread, which is honest about rows written before
--                         anyone could mark them read.
--
-- No existing row is rewritten. No index is dropped. The bot's behaviour on
-- every current conversation is bit-for-bit what it was.

ALTER TABLE "messenger_threads" ADD COLUMN "handoffMode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "messenger_threads" ADD COLUMN "assignedUserId" TEXT;
ALTER TABLE "messenger_threads" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "messenger_threads" ADD COLUMN "lastCustomerAt" TIMESTAMP(3);
ALTER TABLE "messenger_threads" ADD COLUMN "readAt" TIMESTAMP(3);

-- ON DELETE SET NULL, not CASCADE: removing a staff account must never delete
-- the conversations they handled. The customer history is the salon's, not the
-- employee's, and losing it when someone leaves would be unrecoverable.
ALTER TABLE "messenger_threads"
  ADD CONSTRAINT "messenger_threads_assignedUserId_fkey"
  FOREIGN KEY ("assignedUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The inbox's main query is "conversations for this salon, newest first,
-- filtered by who owns them", and the per-person view filters by assignee.
CREATE INDEX "messenger_threads_tenantId_status_updatedAt_idx"
  ON "messenger_threads" ("tenantId", "status", "updatedAt" DESC);
CREATE INDEX "messenger_threads_assignedUserId_idx"
  ON "messenger_threads" ("assignedUserId");

-- Seed lastCustomerAt so the waiting timer and the 24-hour reply window are not
-- blank on every existing conversation the moment the inbox ships.
--
-- updatedAt is an APPROXIMATION - it moves when the bot replies too, so for a
-- thread the bot answered it reads slightly later than the customer's actual
-- message. That is the safe direction for a timer (it under-reports the wait)
-- and the wrong direction for the 24-hour window, which is why the window is
-- also re-stamped from the real webhook on the next incoming message. Both
-- settle to the truth as soon as the customer writes again.
UPDATE "messenger_threads" SET "lastCustomerAt" = "updatedAt" WHERE "lastCustomerAt" IS NULL;
