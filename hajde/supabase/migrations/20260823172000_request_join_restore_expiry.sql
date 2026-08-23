-- Restore table expiration guard in request_join (removed accidentally in
-- 20260820230000_remove_em_dash_waitlist_exception.sql).
-- Keeps the em-dash-free waitlist message from that migration.

CREATE OR REPLACE FUNCTION public.request_join(p_table uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host uuid;
  v_spots int;
  v_count int;
  v_event timestamptz;
  v_req uuid;
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
    RAISE EXCEPTION 'Tavolina është plot. Futu në listën e pritjes';
  END IF;

  INSERT INTO public.requests (table_id, user_id)
  VALUES (p_table, auth.uid())
  RETURNING id INTO v_req;

  RETURN v_req;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_join(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_join(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
