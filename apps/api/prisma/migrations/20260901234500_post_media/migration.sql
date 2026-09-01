-- A scheduled post carries MEDIA, not one image: photo, video, or a carousel of
-- up to ten. The old imageUrl column stays so rows written before this still
-- publish; new rows write media[] and leave it null.
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "media" JSONB NOT NULL DEFAULT '[]';

-- Carry the existing single images across, so nothing already queued loses its
-- picture the moment this deploys.
UPDATE "scheduled_posts"
   SET "media" = jsonb_build_array(jsonb_build_object('url', "imageUrl", 'kind', 'image'))
 WHERE "imageUrl" IS NOT NULL
   AND "imageUrl" <> ''
   AND ("media" IS NULL OR "media" = '[]'::jsonb);
