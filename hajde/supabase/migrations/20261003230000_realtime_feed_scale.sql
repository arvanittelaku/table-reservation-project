-- Realtime that scales with the number of people online.
--
-- Before: every open app subscribed to ALL inserts/updates/deletes of
-- `memberships` and `requests` on the whole platform. Supabase Realtime checks
-- RLS for every subscriber on every change, so one join with 200 people online
-- meant 200 authorization queries + 200 full feed reloads, in every city.
--
-- Now: a join/leave or a request decision just "touches" its table
-- (tables.activity_at). The app listens only to `tables` rows of the city it
-- is showing, so a change reaches only the people looking at that city.
-- Idempotent.

ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS activity_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.touch_table_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_table uuid;
BEGIN
  v_table := (to_jsonb(COALESCE(NEW, OLD)) ->> 'table_id')::uuid;
  IF v_table IS NOT NULL THEN
    UPDATE public.tables SET activity_at = now() WHERE id = v_table;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_table_activity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_memberships_touch_table ON public.memberships;
CREATE TRIGGER trg_memberships_touch_table
  AFTER INSERT OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.touch_table_activity();

DROP TRIGGER IF EXISTS trg_requests_touch_table_ins ON public.requests;
CREATE TRIGGER trg_requests_touch_table_ins
  AFTER INSERT OR DELETE ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_table_activity();

DROP TRIGGER IF EXISTS trg_requests_touch_table ON public.requests;
CREATE TRIGGER trg_requests_touch_table
  AFTER UPDATE OF status ON public.requests
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.touch_table_activity();

-- `tables` must be in the realtime publication (added by 20261003180000);
-- make sure, in case that migration was skipped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tables') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tables;
  END IF;
END $$;
