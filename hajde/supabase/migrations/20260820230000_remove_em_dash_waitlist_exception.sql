-- Replace em dash in user-facing waitlist exception (request_join RPC).
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
  v_req uuid;
BEGIN
  SELECT host_id, spots INTO v_host, v_spots
  FROM public.tables
  WHERE id = p_table AND status = 'open';

  IF v_host IS NULL THEN
    RAISE EXCEPTION 'Tavolina nuk ekziston ose është mbyllur';
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
