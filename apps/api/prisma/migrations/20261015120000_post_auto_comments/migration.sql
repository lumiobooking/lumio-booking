-- First comments under a published post (content/auto-comments.ts).
-- comments: the post's own say (null = the shop's templates; {off:true} = none;
-- {items:[...]} = this list). commentLog: the planned jobs and what became of them.
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "comments" JSONB;
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "commentLog" JSONB NOT NULL DEFAULT '[]';
