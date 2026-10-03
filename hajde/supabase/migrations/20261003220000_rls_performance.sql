-- Database speed: row-level-security policies evaluated once per query instead
-- of once per row, plus the indexes those policies need.
--
-- Measured on a copy with 8k tables / 32k memberships / 24k requests:
-- the city feed spent ~95% of its time re-running policy subqueries for every
-- candidate row (blocks lookup, deactivated-host lookup, three plan helper
-- functions, and for every request/waitlist row a second pass over `tables`).
--
-- Same rules as before, only cheaper:
--   * auth.uid() / helper calls wrapped in (SELECT ...) -> computed once (InitPlan)
--   * "is the host blocked/deactivated" -> one hashed set per query
--   * per-row helper functions replaced by per-query arrays
-- Idempotent.

-- ───────────── helpers (computed once per query via SELECT wrapping) ─────────────

-- Admin check was VOLATILE, which forces a call for every row.
ALTER FUNCTION public.is_admin_user() STABLE;

-- Tables I take part in (member or requested). SECURITY DEFINER: reading
-- requests through RLS from inside a tables policy would recurse.
CREATE OR REPLACE FUNCTION public._my_table_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT table_id), '{}'::uuid[]) FROM (
    SELECT table_id FROM public.memberships WHERE user_id = auth.uid()
    UNION ALL
    SELECT table_id FROM public.requests WHERE user_id = auth.uid()
  ) x
$$;

-- Tables I host (used by requests/waitlist policies without touching tables RLS).
CREATE OR REPLACE FUNCTION public._my_hosted_table_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) FROM public.tables WHERE host_id = auth.uid()
$$;

-- Plan visibility, split so each part is evaluated once per query.
CREATE OR REPLACE FUNCTION public._viewer_sees_all_cities()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND public.is_premium(auth.uid())
$$;

CREATE OR REPLACE FUNCTION public._viewer_home_city()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT home_city FROM public.profiles WHERE id = auth.uid()
$$;

-- Policies run for anonymous visitors too (e.g. the landing page or a shared
-- link before signing in), so both roles must be able to call these. For an
-- anonymous caller auth.uid() is NULL and they return nothing.
REVOKE ALL ON FUNCTION public._my_table_ids(), public._my_hosted_table_ids(),
  public._viewer_sees_all_cities(), public._viewer_home_city() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._my_table_ids(), public._my_hosted_table_ids(),
  public._viewer_sees_all_cities(), public._viewer_home_city() TO anon, authenticated;

-- ───────────── tables ─────────────
DROP POLICY IF EXISTS tables_select ON public.tables;
CREATE POLICY tables_select ON public.tables
  FOR SELECT
  USING (
    event_datetime > now()
    AND status = 'open'
    -- host blocked me or I blocked the host (blocks RLS shows exactly my rows)
    AND host_id NOT IN (
      SELECT CASE WHEN b.blocker_id = (SELECT auth.uid()) THEN b.blocked_id ELSE b.blocker_id END
      FROM public.blocks b
      WHERE b.blocker_id = (SELECT auth.uid()) OR b.blocked_id = (SELECT auth.uid())
    )
    -- deactivated hosts disappear
    AND host_id NOT IN (SELECT p.id FROM public.profiles p WHERE p.deactivated_at IS NOT NULL)
  );

DROP POLICY IF EXISTS tables_select_own ON public.tables;
CREATE POLICY tables_select_own ON public.tables
  FOR SELECT
  USING (host_id = (SELECT auth.uid()));

-- Packages (RESTRICTIVE): Bazike sees only the home city; Premium/admin all.
-- Only (re)created when the plans migration is installed.
DO $$
BEGIN
  IF to_regprocedure('public.can_see_city(text)') IS NOT NULL THEN
    DROP POLICY IF EXISTS tables_plan_city ON public.tables;
    CREATE POLICY tables_plan_city ON public.tables
      AS RESTRICTIVE
      FOR SELECT
      USING (
        host_id = (SELECT auth.uid())
        OR (SELECT public._viewer_sees_all_cities())
        OR (SELECT public.is_admin_user())
        OR city = (SELECT public._viewer_home_city())
        OR id = ANY ((SELECT public._my_table_ids())::uuid[])
      );
  END IF;
END $$;

-- ───────────── requests / waitlist ─────────────
DROP POLICY IF EXISTS requests_select ON public.requests;
CREATE POLICY requests_select ON public.requests
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR table_id = ANY ((SELECT public._my_hosted_table_ids())::uuid[])
  );

DROP POLICY IF EXISTS waitlist_select ON public.waitlist;
CREATE POLICY waitlist_select ON public.waitlist
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR table_id = ANY ((SELECT public._my_hosted_table_ids())::uuid[])
  );

-- ───────────── every other policy: auth.uid() once per query ─────────────
-- Rewrites `auth.uid()` -> `(SELECT auth.uid())` and `is_admin_user()` ->
-- `(SELECT is_admin_user())` in all remaining public policies. Pure
-- performance change (Supabase advisor: auth_rls_initplan); logic unchanged.
DO $$
DECLARE
  r record;
  q text;
  c text;
  sql text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') ~ 'auth\.uid\(\)|is_admin_user\(\)'
           OR coalesce(with_check, '') ~ 'auth\.uid\(\)|is_admin_user\(\)')
  LOOP
    q := r.qual;
    c := r.with_check;
    -- protect calls that are already wrapped, then wrap the rest
    IF q IS NOT NULL THEN
      q := replace(q, '( SELECT auth.uid() AS uid)', '§UID§');
      q := replace(q, '( SELECT is_admin_user() AS is_admin_user)', '§ADM§');
      q := replace(q, 'auth.uid()', '(SELECT auth.uid())');
      q := regexp_replace(q, '(public\.)?is_admin_user\(\)', '(SELECT public.is_admin_user())', 'g');
      q := replace(replace(q, '§UID§', '(SELECT auth.uid())'), '§ADM§', '(SELECT public.is_admin_user())');
    END IF;
    IF c IS NOT NULL THEN
      c := replace(c, '( SELECT auth.uid() AS uid)', '§UID§');
      c := replace(c, '( SELECT is_admin_user() AS is_admin_user)', '§ADM§');
      c := replace(c, 'auth.uid()', '(SELECT auth.uid())');
      c := regexp_replace(c, '(public\.)?is_admin_user\(\)', '(SELECT public.is_admin_user())', 'g');
      c := replace(replace(c, '§UID§', '(SELECT auth.uid())'), '§ADM§', '(SELECT public.is_admin_user())');
    END IF;
    IF q IS DISTINCT FROM r.qual OR c IS DISTINCT FROM r.with_check THEN
      sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
      IF q IS NOT NULL THEN sql := sql || format(' USING (%s)', q); END IF;
      IF c IS NOT NULL THEN sql := sql || format(' WITH CHECK (%s)', c); END IF;
      EXECUTE sql;
    END IF;
  END LOOP;
END $$;

-- ───────────── indexes the policies and the app filter on ─────────────
CREATE INDEX IF NOT EXISTS idx_requests_user ON public.requests (user_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_user ON public.waitlist (user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON public.blocks (blocked_id);
CREATE INDEX IF NOT EXISTS idx_connections_b ON public.connections (b);
CREATE INDEX IF NOT EXISTS idx_ratings_rater ON public.ratings (rater_id);
CREATE INDEX IF NOT EXISTS idx_profiles_deactivated ON public.profiles (id) WHERE deactivated_at IS NOT NULL;
-- feed: open tables of a city ordered by time
CREATE INDEX IF NOT EXISTS idx_tables_city_time ON public.tables (city, event_datetime) WHERE status = 'open';

ANALYZE public.tables, public.memberships, public.requests, public.waitlist, public.blocks, public.profiles;

NOTIFY pgrst, 'reload schema';
