-- One-time production cleanup: delete all non-admin users and dependent data.
-- KEEP: profiles where is_admin = true (ejabashkohu@gmail.com admin).
-- Run in Supabase Dashboard → SQL Editor (project upxxfhvgbmddhyebaiug).

DO $$
DECLARE
  v_ids uuid[];
  c_payments int := 0;
  c_reports_reviewed int := 0;
  c_auth_users int := 0;
  c_before_profiles int;
  c_after_profiles int;
  c_before_bans int;
  c_after_bans int;
  c_before_reports int;
  c_after_reports int;
BEGIN
  SELECT count(*) INTO c_before_profiles FROM public.profiles;
  SELECT count(*) INTO c_before_bans FROM public.bans;
  SELECT count(*) INTO c_before_reports FROM public.reports;

  SELECT coalesce(array_agg(p.id), '{}')
    INTO v_ids
  FROM public.profiles p
  WHERE coalesce(p.is_admin, false) IS NOT TRUE;

  IF array_length(v_ids, 1) IS NULL THEN
    RAISE NOTICE 'No non-admin profiles to delete.';
    RETURN;
  END IF;

  RAISE NOTICE 'Deleting % non-admin profile(s). Keeping % admin profile(s).',
    array_length(v_ids, 1),
    (SELECT count(*) FROM public.profiles WHERE is_admin IS TRUE);

  -- payments.user_id has no ON DELETE CASCADE
  DELETE FROM public.payments WHERE user_id = ANY (v_ids);
  GET DIAGNOSTICS c_payments = ROW_COUNT;

  -- reports.reviewed_by has no ON DELETE CASCADE (reviewer should be admin, but clear defensively)
  UPDATE public.reports
     SET reviewed_by = NULL
   WHERE reviewed_by = ANY (v_ids);
  GET DIAGNOSTICS c_reports_reviewed = ROW_COUNT;

  -- auth.users delete cascades to profiles and all profile FK children with ON DELETE CASCADE:
  -- taste_profiles, affinity, memberships, requests, waitlist, messages, ratings,
  -- connection_picks, connections, notifications, reports (reporter/reported),
  -- blocks, badges, bans, wednesday_participants, tables (host_id)
  DELETE FROM auth.users WHERE id = ANY (v_ids);
  GET DIAGNOSTICS c_auth_users = ROW_COUNT;

  SELECT count(*) INTO c_after_profiles FROM public.profiles;
  SELECT count(*) INTO c_after_bans FROM public.bans;
  SELECT count(*) INTO c_after_reports FROM public.reports;

  RAISE NOTICE '--- Deletion summary ---';
  RAISE NOTICE 'payments deleted: %', c_payments;
  RAISE NOTICE 'reports.reviewed_by nulled: %', c_reports_reviewed;
  RAISE NOTICE 'auth.users deleted: %', c_auth_users;
  RAISE NOTICE 'profiles before/after: % / %', c_before_profiles, c_after_profiles;
  RAISE NOTICE 'bans before/after: % / %', c_before_bans, c_after_bans;
  RAISE NOTICE 'reports before/after: % / %', c_before_reports, c_after_reports;
END $$;

-- Step 4 verification
SELECT count(*) AS profiles_remaining FROM public.profiles;

SELECT p.id, p.first_name, p.last_name, u.email, p.is_admin, p.created_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
ORDER BY p.created_at;

SELECT count(*) AS bans_remaining FROM public.bans;
SELECT count(*) AS reports_remaining FROM public.reports;
