-- When a person answers a chat, the AI stays quiet (Amy's Lash and Brows, 7 Nov 2026:
-- "chị đang trực tiếp trả lời mà AI vẫn chen vào").
-- New defaults: a person counts as in the chat for 120 minutes after their last
-- line (was 15), and the bot no longer answers over them after a grace (was 5 min).
-- Salons that never changed the old defaults move to the new ones; a salon that
-- chose its own numbers keeps them.
ALTER TABLE "messenger_connections" ALTER COLUMN "humanActiveMins" SET DEFAULT 120;
ALTER TABLE "messenger_connections" ALTER COLUMN "graceMins" SET DEFAULT 0;
UPDATE "messenger_connections" SET "humanActiveMins" = 120 WHERE "humanActiveMins" = 15;
UPDATE "messenger_connections" SET "graceMins" = 0 WHERE "graceMins" = 5;
