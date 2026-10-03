-- Live listings: broadcast new/changed tables and lessons so feeds update
-- without a refresh. Realtime still applies RLS, so users only receive rows
-- they are allowed to see (e.g. not tables of hosts who blocked them).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tables', 'lessons', 'lesson_participants'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
