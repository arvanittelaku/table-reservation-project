-- Admin panel: is_admin flag, report review workflow, stats RPCs, bans read policy

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed_banned', 'reviewed_dismissed', 'deleted_immediately')),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
$$;

DROP POLICY IF EXISTS reports_select_admin ON public.reports;
CREATE POLICY reports_select_admin ON public.reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_admin_user());

DROP POLICY IF EXISTS reports_update_admin ON public.reports;
CREATE POLICY reports_update_admin ON public.reports
  FOR UPDATE TO authenticated
  USING (public.is_admin_user());

CREATE OR REPLACE FUNCTION public.admin_dismiss_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta bëjnë këtë';
  END IF;
  UPDATE public.reports
  SET status = 'reviewed_dismissed', reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_report_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_dismiss_report FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dismiss_report TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ban_from_report(p_report_id uuid, p_reason text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reported uuid; v_count int;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta bëjnë këtë';
  END IF;
  SELECT reported_id INTO v_reported FROM public.reports WHERE id = p_report_id;
  v_count := public.ban_user(v_reported, p_reason);
  UPDATE public.reports
  SET status = 'reviewed_banned', reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_report_id;
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_ban_from_report FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ban_from_report TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_immediately(p_report_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reported uuid;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta bëjnë këtë';
  END IF;
  SELECT reported_id INTO v_reported FROM public.reports WHERE id = p_report_id;

  UPDATE public.reports
  SET status = 'deleted_immediately', reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_report_id;

  PERFORM net.http_post(
    url := 'https://upxxfhvgbmddhyebaiug.supabase.co/functions/v1/delete-banned-user',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_key', true)
    ),
    body := jsonb_build_object('user_id', v_reported)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_immediately FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_immediately TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_stats(p_range text DEFAULT 'month')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_interval interval;
  v_bucket text;
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta shohin këtë';
  END IF;

  v_interval := CASE p_range
    WHEN 'day' THEN interval '30 days'
    WHEN 'month' THEN interval '12 months'
    WHEN 'year' THEN interval '5 years'
    ELSE interval '12 months'
  END;
  v_bucket := CASE p_range
    WHEN 'day' THEN 'day'
    WHEN 'month' THEN 'month'
    WHEN 'year' THEN 'year'
    ELSE 'month'
  END;

  SELECT jsonb_build_object(
    'new_users', (
      SELECT jsonb_agg(jsonb_build_object('period', period, 'count', cnt) ORDER BY period)
      FROM (
        SELECT date_trunc(v_bucket, created_at) AS period, count(*) AS cnt
        FROM auth.users
        WHERE created_at >= now() - v_interval
        GROUP BY 1
      ) x
    ),
    'tables_opened', (
      SELECT jsonb_agg(jsonb_build_object('period', period, 'count', cnt) ORDER BY period)
      FROM (
        SELECT date_trunc(v_bucket, created_at) AS period, count(*) AS cnt
        FROM public.tables
        WHERE created_at >= now() - v_interval
        GROUP BY 1
      ) x
    ),
    'memberships_joined', (
      SELECT jsonb_agg(jsonb_build_object('period', period, 'count', cnt) ORDER BY period)
      FROM (
        SELECT date_trunc(v_bucket, joined_at) AS period, count(*) AS cnt
        FROM public.memberships
        WHERE joined_at >= now() - v_interval
        GROUP BY 1
      ) x
    ),
    'totals', jsonb_build_object(
      'total_users', (SELECT count(*) FROM auth.users),
      'total_tables', (SELECT count(*) FROM public.tables),
      'total_memberships', (SELECT count(*) FROM public.memberships),
      'active_tables_now', (SELECT count(*) FROM public.tables WHERE status = 'open'),
      'pending_reports', (SELECT count(*) FROM public.reports WHERE status = 'pending'),
      'total_bans', (SELECT count(*) FROM public.bans),
      'banned_users_distinct', (SELECT count(DISTINCT user_id) FROM public.bans)
    )
  ) INTO v_result;

  RETURN v_result;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_get_stats FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_stats TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_reports(p_status text DEFAULT 'pending')
RETURNS TABLE (
  id uuid, reason text, status text, created_at timestamptz,
  reporter_name text, reported_name text, reported_id uuid,
  table_id uuid, table_title text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta shohin këtë';
  END IF;
  RETURN QUERY
  SELECT r.id, r.reason, r.status, r.created_at,
         pr.first_name || ' ' || pr.last_name,
         pd.first_name || ' ' || pd.last_name,
         r.reported_id,
         r.table_id,
         t.title
  FROM public.reports r
  JOIN public.profiles pr ON pr.id = r.reporter_id
  JOIN public.profiles pd ON pd.id = r.reported_id
  LEFT JOIN public.tables t ON t.id = r.table_id
  WHERE r.status = p_status
  ORDER BY r.created_at DESC;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_get_reports FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_reports TO authenticated;

DROP POLICY IF EXISTS bans_select_admin ON public.bans;
CREATE POLICY bans_select_admin ON public.bans
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_user());

NOTIFY pgrst, 'reload schema';
