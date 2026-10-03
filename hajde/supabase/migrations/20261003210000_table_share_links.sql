-- Shareable table links: https://ejabashkohu.com/t/<share_code>
--
-- * Every table gets a short, stable, non-sequential code (8 chars, no look-alike
--   characters) so links are short in WhatsApp/Instagram and do not expose ids.
-- * table_share_preview(code) is the ONLY thing anonymous visitors (and link
--   preview crawlers) can read: title, type, city/area, time and seats. Never the
--   maps link, exact address, participants or anything of a secret place.
-- * Opening the full table still goes through the normal RLS (signed in, plan
--   city rules, blocks). The preview tells the app whether this user can open it.
-- Idempotent.

CREATE OR REPLACE FUNCTION public._new_share_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz'; -- 31 chars, no 0/o/1/l/i
  h text;
  code text;
BEGIN
  LOOP
    h := md5(gen_random_uuid()::text || clock_timestamp()::text);
    code := '';
    FOR i IN 0..7 LOOP
      code := code || substr(alphabet, 1 + (('x' || substr(h, i * 2 + 1, 2))::bit(8)::int % 31), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tables WHERE share_code = code);
  END LOOP;
  RETURN code;
END;
$$;

ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS share_code text;

UPDATE public.tables SET share_code = public._new_share_code() WHERE share_code IS NULL;

ALTER TABLE public.tables ALTER COLUMN share_code SET DEFAULT public._new_share_code();
ALTER TABLE public.tables ALTER COLUMN share_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tables_share_code_key ON public.tables (share_code);

-- The code is permanent: a link shared once must keep working.
CREATE OR REPLACE FUNCTION public.tables_keep_share_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.share_code IS DISTINCT FROM OLD.share_code THEN
    NEW.share_code := OLD.share_code;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tables_keep_share_code ON public.tables;
CREATE TRIGGER trg_tables_keep_share_code
  BEFORE UPDATE OF share_code ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.tables_keep_share_code();

-- Public preview. Accepts the share code or (for old links) the table uuid.
CREATE OR REPLACE FUNCTION public.table_share_preview(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tables%ROWTYPE;
  v_uid uuid := auth.uid();
  v_taken int;
  v_secret boolean;
  v_can_open boolean := false;
  v_reason text := NULL;
  v_host_first text;
BEGIN
  IF p_code IS NULL OR length(p_code) > 64 THEN RETURN NULL; END IF;

  SELECT * INTO t FROM public.tables
  WHERE share_code = lower(p_code)
     OR (p_code ~* '^[0-9a-f-]{36}$' AND id = p_code::uuid)
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Wednesday dinner groups are private and their restaurant is secret.
  IF t.kind = 'darka_e_merkures' THEN RETURN NULL; END IF;

  v_secret := COALESCE(t.mystery, false) AND NOT COALESCE(t.revealed, false);
  SELECT count(*) INTO v_taken FROM public.memberships m WHERE m.table_id = t.id;
  SELECT first_name INTO v_host_first FROM public.profiles WHERE id = t.host_id;

  IF v_uid IS NULL THEN
    v_reason := 'sign_in';
  ELSE
    -- Same visibility the app gets through RLS.
    IF to_regprocedure('public.can_see_city(text)') IS NOT NULL
       AND t.host_id <> v_uid
       AND NOT public.can_see_city(t.city)
       AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.table_id = t.id AND m.user_id = v_uid)
       AND NOT COALESCE((SELECT is_admin FROM public.profiles WHERE id = v_uid), false) THEN
      v_reason := 'premium_city';
    ELSIF to_regclass('public.blocks') IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = t.host_id AND b.blocked_id = v_uid)
         OR (b.blocker_id = v_uid AND b.blocked_id = t.host_id)) THEN
      v_reason := 'hidden';
    ELSE
      v_can_open := true;
    END IF;
  END IF;

  IF v_reason = 'hidden' THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'id', CASE WHEN v_can_open THEN t.id END,
    'share_code', t.share_code,
    'title', CASE WHEN v_secret THEN NULL ELSE t.title END,
    'secret', v_secret,
    'kind', t.kind,
    'category', t.category,
    'sport', t.sport,
    'city', t.city,
    'to_city', t.to_city,
    'area', CASE WHEN v_secret THEN NULL ELSE t.area END,
    'event_datetime', t.event_datetime,
    'time_label', t.time_label,
    'spots', t.spots,
    'taken', v_taken,
    'status', CASE
      WHEN t.status <> 'open' THEN 'closed'
      WHEN t.event_datetime IS NOT NULL AND t.event_datetime < now() THEN 'past'
      WHEN v_taken >= t.spots THEN 'full'
      ELSE 'open' END,
    'women_only', COALESCE(t.women_only, false),
    'men_only', COALESCE(t.men_only, false),
    'host_first_name', v_host_first,
    'can_open', v_can_open,
    'reason', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.table_share_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_share_preview(text) TO anon, authenticated;
-- used as the column default, so whoever inserts a table must be able to run it
REVOKE ALL ON FUNCTION public._new_share_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._new_share_code() TO authenticated;

NOTIFY pgrst, 'reload schema';
