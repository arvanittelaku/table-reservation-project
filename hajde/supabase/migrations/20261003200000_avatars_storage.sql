-- Profile photos: make sure the private "avatars" bucket and its policies exist.
-- Until now the bucket was only configured by hand in the dashboard, so a
-- missing/old policy or a tight size/type limit made every upload fail.
-- Idempotent: safe to run on a project where the bucket already exists.

-- 1. Bucket (private; photos are only served through 1-hour signed URLs).
--    The app now uploads a re-encoded JPEG of ~150-300 KB; 5 MB leaves room.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    -- never shrink an existing limit; NULL means "no bucket limit", keep it
    file_size_limit = CASE
      WHEN storage.buckets.file_size_limit IS NULL THEN NULL
      ELSE GREATEST(storage.buckets.file_size_limit, 5242880)
    END,
    -- keep whatever was allowed and make sure JPEG is among it
    allowed_mime_types = CASE
      WHEN storage.buckets.allowed_mime_types IS NULL THEN NULL
      ELSE ARRAY(SELECT DISTINCT unnest(storage.buckets.allowed_mime_types || ARRAY['image/jpeg', 'image/png', 'image/webp']))
    END;

-- 2. Policies. Each user writes only inside their own folder: avatars/{uid}/...
--    upload(..., { upsert: true }) needs INSERT + UPDATE (+ SELECT to find the
--    existing object). Signed-in users can read avatars so the feed can show
--    hosts' and members' photos through signed URLs.
DROP POLICY IF EXISTS avatars_read_authenticated ON storage.objects;
CREATE POLICY avatars_read_authenticated ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS avatars_insert_own ON storage.objects;
CREATE POLICY avatars_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS avatars_update_own ON storage.objects;
CREATE POLICY avatars_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS avatars_delete_own ON storage.objects;
CREATE POLICY avatars_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
