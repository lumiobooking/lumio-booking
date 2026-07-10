-- Running ticket: services performed during a walk-in visit, accumulated live.
ALTER TABLE "walk_ins" ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';
