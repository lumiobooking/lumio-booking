-- rt200: a team member who only answers customer messages (the Inbox).
-- Its own migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'CHAT';
