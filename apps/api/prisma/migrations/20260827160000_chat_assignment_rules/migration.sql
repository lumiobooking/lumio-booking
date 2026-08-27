-- Auto-distribution of conversations to staff.
--
-- WHY 'off' IS THE DEFAULT
--
-- This changes who answers a customer. A salon that has not asked for it must
-- not acquire it by taking an update — they would find out when a customer got
-- a reply from a technician who was not expecting to be answering chat. So the
-- migration adds the switch in the off position and every existing salon keeps
-- exactly the behaviour it has: the bot answers, a human takes over by hand.
--
-- chatMaxOpenPerAgent 5 and chatPreferUsualTech true are the values that apply
-- ONLY once someone turns the mode on, so their defaults change nothing today.

ALTER TABLE "messenger_connections" ADD COLUMN "chatAssignMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "messenger_connections" ADD COLUMN "chatMaxOpenPerAgent" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "messenger_connections" ADD COLUMN "chatPreferUsualTech" BOOLEAN NOT NULL DEFAULT true;

-- Where the rotation stopped last time. Plain text, no foreign key: it is a
-- pointer, not a relationship, and a staff member leaving must not fail a write
-- or drag a cascade through the connection row. An id nobody recognises simply
-- restarts the rotation, which is the correct behaviour anyway.
ALTER TABLE "messenger_connections" ADD COLUMN "chatLastAssignedId" TEXT;
