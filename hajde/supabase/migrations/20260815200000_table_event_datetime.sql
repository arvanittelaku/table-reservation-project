-- Real table scheduling: event_datetime + feed expiration + request guards

ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS event_datetime timestamptz;

-- Existing test rows → treat as expired (created_at is in the past)
UPDATE public.tables
SET event_datetime = created_at
WHERE event_datetime IS NULL;

ALTER TABLE public.tables
  ALTER COLUMN event_datetime SET NOT NULL;

ALTER TABLE public.tables
  DROP CONSTRAINT IF EXISTS event_datetime_future;

ALTER TABLE public.tables
  ADD CONSTRAINT event_datetime_future
  CHECK (event_datetime > created_at - interval '5 minutes');

CREATE INDEX IF NOT EXISTS idx_tables_event_datetime
  ON public.tables (event_datetime)
  WHERE status = 'open';

-- Feed: only non-expired open tables (plus host-own policy below)
DROP POLICY IF EXISTS tables_select ON public.tables;
CREATE POLICY tables_select ON public.tables
  FOR SELECT TO authenticated USING (
    event_datetime > now()
    AND status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks
      WHERE (blocker_id = auth.uid() AND blocked_id = host_id)
         OR (blocker_id = host_id AND blocked_id = auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = host_id AND p.deactivated_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS tables_select_own ON public.tables;
CREATE POLICY tables_select_own ON public.tables
  FOR SELECT TO authenticated USING (host_id = auth.uid());

-- Block creating tables scheduled in the past (belt + suspenders with CHECK)
DROP POLICY IF EXISTS tables_insert ON public.tables;
CREATE POLICY tables_insert ON public.tables
  FOR INSERT TO authenticated WITH CHECK (
    host_id = auth.uid()
    AND event_datetime > now()
  );

-- Join requests: RPC guard (primary path)
CREATE OR REPLACE FUNCTION public.request_join(p_table uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_req uuid; v_host uuid; v_spots int; v_count int; v_event timestamptz;
BEGIN
  SELECT host_id, spots, event_datetime
    INTO v_host, v_spots, v_event
    FROM public.tables
    WHERE id = p_table AND status = 'open';

  IF v_host IS NULL THEN
    RAISE EXCEPTION 'Tavolina nuk ekziston ose është mbyllur';
  END IF;

  IF v_event <= now() THEN
    RAISE EXCEPTION 'Kjo tavolinë ka skaduar';
  END IF;

  IF v_host = auth.uid() THEN
    RAISE EXCEPTION 'Je vetë nikoqiri';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = v_host AND blocked_id = auth.uid())
       OR (blocker_id = auth.uid() AND blocked_id = v_host)
  ) THEN
    RAISE EXCEPTION 'Veprimi nuk lejohet';
  END IF;

  SELECT count(*) INTO v_count FROM public.memberships WHERE table_id = p_table;
  IF v_count >= v_spots THEN
    RAISE EXCEPTION 'Tavolina është plot — futu në listën e pritjes';
  END IF;

  INSERT INTO public.requests (table_id, user_id)
  VALUES (p_table, auth.uid())
  RETURNING id INTO v_req;

  RETURN v_req;
END $$;

REVOKE EXECUTE ON FUNCTION public.request_join(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_join(uuid) TO authenticated;

-- Direct insert fallback guard (RPC is primary)
DROP POLICY IF EXISTS requests_insert ON public.requests;
CREATE POLICY requests_insert ON public.requests
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tables t
      WHERE t.id = table_id
        AND t.event_datetime > now()
        AND t.status = 'open'
    )
  );

-- Waitlist: same expiration guard
DROP POLICY IF EXISTS waitlist_insert_own ON public.waitlist;
CREATE POLICY waitlist_insert_own ON public.waitlist
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tables t
      WHERE t.id = table_id
        AND t.event_datetime > now()
        AND t.status = 'open'
    )
  );

NOTIFY pgrst, 'reload schema';
