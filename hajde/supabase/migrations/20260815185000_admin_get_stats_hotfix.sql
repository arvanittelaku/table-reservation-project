-- Hotfix: memberships uses joined_at, not created_at
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

REVOKE EXECUTE ON FUNCTION public.admin_get_stats(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_stats(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
