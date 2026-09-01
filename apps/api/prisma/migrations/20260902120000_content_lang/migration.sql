-- Which language the AI writes a salon's plan and ideas in.
--
-- NULL keeps the behaviour that existed before this column: decide from the
-- market. This is deliberately NOT the interface language — a Vietnamese owner
-- running a salon in Texas reads the plan in Vietnamese and posts captions in
-- English, because her customers are American.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "contentLang" TEXT;
