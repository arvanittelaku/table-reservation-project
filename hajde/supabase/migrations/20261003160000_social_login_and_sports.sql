-- ═══════════════════════════════════════════════════════════════════
--  1) Google / Apple sign-in without skipping onboarding
--  2) Sports games, each locked to exactly one sport
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────── 1a. Profiles created by OAuth ─────────────────────────
-- handle_new_user() copies first_name/last_name from signup metadata. Google sends
-- full_name/given_name/family_name and Apple often sends no name at all, so
-- last_name came out '' and the CHECK (1..40 chars) made the whole OAuth signup
-- fail ("Database error saving new user"). A BEFORE INSERT trigger on profiles
-- fills sensible names first; handle_new_user itself is not redefined.
CREATE OR REPLACE FUNCTION public.profiles_fill_oauth_names()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m jsonb;
  v_full text;
BEGIN
  IF COALESCE(NULLIF(trim(NEW.last_name), ''), '') <> '' AND NEW.first_name IS DISTINCT FROM 'Përdorues' THEN
    RETURN NEW;
  END IF;

  SELECT raw_user_meta_data INTO m FROM auth.users WHERE id = NEW.id;
  m := COALESCE(m, '{}'::jsonb);
  v_full := NULLIF(trim(COALESCE(m->>'full_name', m->>'name', '')), '');

  IF NEW.first_name IS NULL OR NEW.first_name = 'Përdorues' OR trim(NEW.first_name) = '' THEN
    NEW.first_name := COALESCE(
      NULLIF(trim(m->>'given_name'), ''),
      NULLIF(split_part(v_full, ' ', 1), ''),
      'Përdorues');
  END IF;

  IF NEW.last_name IS NULL OR trim(NEW.last_name) = '' THEN
    NEW.last_name := COALESCE(
      NULLIF(trim(m->>'family_name'), ''),
      NULLIF(trim(substr(v_full, length(split_part(v_full, ' ', 1)) + 2)), ''),
      '-');
  END IF;

  NEW.first_name := left(NEW.first_name, 40);
  NEW.last_name := left(NEW.last_name, 40);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_fill_oauth_names ON public.profiles;
CREATE TRIGGER trg_profiles_fill_oauth_names
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_fill_oauth_names();

-- ───────────────────────── 1b. Onboarding must be completed ─────────────────────────
-- Until now "onboarding done" was only checked in the browser
-- (user_preferences.terms_agreed). An OAuth account gets a profile row the moment
-- it is created, so the database now enforces it: no hosting, joining or
-- waitlisting until complete_onboarding() has set onboarded_at.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- Everyone who already finished signup (or has clearly used the app) keeps access.
UPDATE public.profiles p
SET onboarded_at = COALESCE(p.onboarded_at, p.created_at)
WHERE p.onboarded_at IS NULL
  AND (
    (p.user_preferences->>'terms_agreed')::boolean IS TRUE
    OR p.is_admin
    OR EXISTS (SELECT 1 FROM public.tables t WHERE t.host_id = p.id)
    OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = p.id)
    OR EXISTS (SELECT 1 FROM public.requests r WHERE r.user_id = p.id)
    OR (p.first_name <> 'Përdorues' AND p.photo_path IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_first_name text,
  p_last_name text,
  p_age int,
  p_is_tourist boolean DEFAULT false,
  p_from_place text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first text := trim(COALESCE(p_first_name, ''));
  v_last text := trim(COALESCE(p_last_name, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Duhet të jesh i kyçur';
  END IF;
  IF char_length(v_first) NOT BETWEEN 1 AND 40 OR char_length(v_last) NOT BETWEEN 1 AND 40
     OR v_first = 'Përdorues' OR v_last = '-' THEN
    RAISE EXCEPTION 'Shkruaj emrin dhe mbiemrin';
  END IF;
  IF p_age IS NULL OR p_age NOT BETWEEN 18 AND 99 THEN
    RAISE EXCEPTION 'Duhet të kesh të paktën 18 vjeç';
  END IF;

  UPDATE public.profiles
  SET first_name = v_first,
      last_name = v_last,
      age = p_age,
      is_tourist = COALESCE(p_is_tourist, false),
      from_place = CASE WHEN p_is_tourist THEN NULLIF(trim(COALESCE(p_from_place, '')), '') END,
      user_preferences = COALESCE(user_preferences, '{}'::jsonb) || jsonb_build_object(
        'terms_agreed', true,
        'terms_agreed_at', now(),
        'terms_version', '2026-08'),
      onboarded_at = COALESCE(onboarded_at, now())
  WHERE id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.complete_onboarding(text, text, int, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, text, int, boolean, text) TO authenticated;

-- onboarded_at can only be set through complete_onboarding (or by an admin).
CREATE OR REPLACE FUNCTION public.profiles_protect_onboarded_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Direct client updates run as role "authenticated"; complete_onboarding() is
  -- SECURITY DEFINER, so inside it current_user is the function owner.
  IF NEW.onboarded_at IS DISTINCT FROM OLD.onboarded_at
     AND current_user IN ('authenticated', 'anon')
     AND NOT public.is_admin_user() THEN
    NEW.onboarded_at := OLD.onboarded_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_protect_onboarded_at ON public.profiles;
CREATE TRIGGER trg_profiles_protect_onboarded_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_onboarded_at();

CREATE OR REPLACE FUNCTION public.require_onboarded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user uuid;
BEGIN
  -- via jsonb: plpgsql would otherwise resolve NEW.user_id on `tables` (no such column)
  v_user := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'tables' THEN 'host_id' ELSE 'user_id' END)::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user AND onboarded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Plotëso profilin (emri, mosha, foto) para se të vazhdosh' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tables_require_onboarded ON public.tables;
CREATE TRIGGER trg_tables_require_onboarded
  BEFORE INSERT ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.require_onboarded();

DROP TRIGGER IF EXISTS trg_requests_require_onboarded ON public.requests;
CREATE TRIGGER trg_requests_require_onboarded
  BEFORE INSERT ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.require_onboarded();

DROP TRIGGER IF EXISTS trg_waitlist_require_onboarded ON public.waitlist;
CREATE TRIGGER trg_waitlist_require_onboarded
  BEFORE INSERT ON public.waitlist
  FOR EACH ROW EXECUTE FUNCTION public.require_onboarded();

-- ───────────────────────── 2. Sports ─────────────────────────
-- kind 'sport' + exactly one sport per game. A football game can never show up
-- as volleyball: the sport is a required, validated column, not free text.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tables'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%kind%' OR pg_get_constraintdef(oid) ILIKE '%spots%')
      AND conname NOT IN ('tables_sport_valid', 'tables_skill_level_valid', 'tables_sport_consistency')
  LOOP
    EXECUTE format('ALTER TABLE public.tables DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.tables
  ADD CONSTRAINT tables_kind_check
  CHECK (kind IN ('tavoline', 'vozitje', 'udhetim', 'darka_e_merkures', 'sport'));

-- 11-a-side football needs 22 players; other kinds keep their old 1..20 range.
ALTER TABLE public.tables
  ADD CONSTRAINT tables_spots_check
  CHECK (spots BETWEEN 1 AND CASE WHEN kind = 'sport' THEN 30 ELSE 20 END);

ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS sport text;
ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS skill_level text;

ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_sport_valid;
ALTER TABLE public.tables
  ADD CONSTRAINT tables_sport_valid
  CHECK (sport IS NULL OR sport IN (
    'football', 'basketball', 'volleyball', 'tennis', 'padel',
    'table_tennis', 'badminton', 'running', 'fitness'));

ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_skill_level_valid;
ALTER TABLE public.tables
  ADD CONSTRAINT tables_skill_level_valid
  CHECK (skill_level IS NULL OR skill_level IN ('any', 'beginner', 'intermediate', 'advanced'));

-- A sport game must name its sport (and nothing else may).
ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_sport_consistency;
ALTER TABLE public.tables
  ADD CONSTRAINT tables_sport_consistency
  CHECK (
    (kind = 'sport' AND sport IS NOT NULL AND category = 'sport')
    OR (kind <> 'sport' AND sport IS NULL AND skill_level IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_tables_city_sport ON public.tables (city, sport) WHERE status = 'open' AND kind = 'sport';

NOTIFY pgrst, 'reload schema';
