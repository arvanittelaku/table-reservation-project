-- Which migrations are live?  Paste into Supabase → SQL Editor → Run.
-- Read-only: changes nothing. One row per migration file, ✅ live / ❌ missing.
-- Migrations run by hand in the SQL editor are not recorded by the Supabase
-- CLI, so this checks for the objects each migration creates instead.

WITH fn AS (
  SELECT p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
),
col AS (
  SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
),
pol AS (
  SELECT schemaname, tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr FROM pg_policies
),
checks(migration, ok, needs) AS (VALUES
  ('20260811220000_features_1_5',             to_regclass('public.wednesday_participants') IS NOT NULL, 'table wednesday_participants'),
  ('20260815180000_admin_panel',              EXISTS (SELECT 1 FROM col WHERE table_name = 'profiles' AND column_name = 'is_admin'), 'profiles.is_admin'),
  ('20260815185000_admin_get_stats_hotfix',   EXISTS (SELECT 1 FROM fn WHERE proname = 'admin_get_stats' AND prosrc ILIKE '%joined_at%'), 'admin_get_stats uses joined_at'),
  ('20260815190000_admin_stats_perf',         to_regclass('public.idx_memberships_joined_at') IS NOT NULL, 'index idx_memberships_joined_at'),
  ('20260815190500_cleanup_test_admin_rows',  NULL::boolean, 'optional data cleanup, nothing to check'),
  ('20260815200000_table_event_datetime',     EXISTS (SELECT 1 FROM col WHERE table_name = 'tables' AND column_name = 'event_datetime'), 'tables.event_datetime'),
  ('20260816150000_permanent_deactivation',   EXISTS (SELECT 1 FROM fn WHERE proname = 'prevent_reactivation'), 'function prevent_reactivation'),
  ('20260816150500_admin_reactivate_account', EXISTS (SELECT 1 FROM fn WHERE proname = 'admin_reactivate_account'), 'function admin_reactivate_account'),
  ('20260816150600_admin_reactivate_hotfix',  EXISTS (SELECT 1 FROM fn WHERE proname = 'admin_reactivate_account'), 'function admin_reactivate_account'),
  ('20260816170000_men_only',                 EXISTS (SELECT 1 FROM col WHERE table_name = 'tables' AND column_name = 'men_only'), 'tables.men_only'),
  ('20260817190000_ban_user_vault',           EXISTS (SELECT 1 FROM fn WHERE proname = 'ban_user' AND prosrc ILIKE '%vault%'), 'ban_user reads vault'),
  ('20260817190500_admin_get_http_responses', EXISTS (SELECT 1 FROM fn WHERE proname = 'admin_get_http_responses'), 'function admin_get_http_responses'),
  ('20260817194500_email_on_request_vault',   EXISTS (SELECT 1 FROM fn WHERE proname = 'email_on_request' AND prosrc ILIKE '%vault%'), 'email_on_request reads vault'),
  ('20260820230000_remove_em_dash',           EXISTS (SELECT 1 FROM fn WHERE proname = 'request_join' AND prosrc NOT LIKE '%—%'), 'request_join without em dash'),
  ('20260820240000_requests_blocks_guard',    EXISTS (SELECT 1 FROM pol WHERE tablename = 'requests' AND policyname = 'requests_insert' AND expr ILIKE '%blocks%'), 'requests_insert checks blocks'),
  ('20260820241000_blocks_bidirectional',     EXISTS (SELECT 1 FROM pol WHERE tablename = 'blocks' AND policyname = 'blocks_own' AND expr ILIKE '%blocked_id%'), 'policy blocks_own both ways'),
  ('20260820242000_blocks_insert_delete',     EXISTS (SELECT 1 FROM pol WHERE tablename = 'blocks' AND policyname = 'blocks_delete_own'), 'policy blocks_delete_own'),
  ('20260822230000_maps_link_validation',     EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tables_maps_link_check'), 'constraint tables_maps_link_check'),
  ('20260822240000_wednesday_secrecy_rls',    EXISTS (SELECT 1 FROM fn WHERE proname = 'get_my_wednesday_groups'), 'function get_my_wednesday_groups'),
  ('20260823172000_request_join_expiry',      EXISTS (SELECT 1 FROM fn WHERE proname = 'request_join' AND prosrc ILIKE '%skaduar%'), 'request_join expiry guard'),
  ('20261003120000_admin_panel_v2',           EXISTS (SELECT 1 FROM col WHERE table_name = 'payments' AND column_name = 'payer_name'), 'payments.payer_name'),
  ('20261003150000_notifications_i18n',       EXISTS (SELECT 1 FROM col WHERE table_name = 'notifications' AND column_name = 'params'), 'notifications.params'),
  ('20261003160000_social_login_and_sports',  EXISTS (SELECT 1 FROM fn WHERE proname = 'complete_onboarding'), 'function complete_onboarding'),
  ('20261003170000_lessons',                  to_regclass('public.tutors') IS NOT NULL, 'table tutors'),
  ('20261003180000_realtime_listings',        EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tables'), 'tables in realtime publication'),
  ('20261003190000_plans_and_wednesday',      to_regclass('public.subscriptions') IS NOT NULL AND EXISTS (SELECT 1 FROM fn WHERE proname = 'my_plan'), 'table subscriptions + my_plan()'),
  ('20261003200000_avatars_storage',          EXISTS (SELECT 1 FROM pol WHERE schemaname = 'storage' AND policyname = 'avatars_insert_own'), 'storage policy avatars_insert_own'),
  ('20261003210000_table_share_links',        EXISTS (SELECT 1 FROM fn WHERE proname = 'table_share_preview'), 'function table_share_preview'),
  ('20261003220000_rls_performance',          EXISTS (SELECT 1 FROM pol WHERE tablename = 'requests' AND policyname = 'requests_select' AND expr ILIKE '%_my_hosted_table_ids%'), 'fast requests_select policy'),
  ('20261003230000_realtime_feed_scale',      EXISTS (SELECT 1 FROM col WHERE table_name = 'tables' AND column_name = 'activity_at'), 'tables.activity_at')
)
SELECT
  migration,
  CASE WHEN ok IS NULL THEN '➖ n/a' WHEN ok THEN '✅ live' ELSE '❌ MISSING' END AS status,
  needs AS checked
FROM checks
ORDER BY migration;
