# SQL → Python checklist

Every database object of the old implementation and where it lives now.
Verified by `dev/difftest.py` (130 cases, old SQL vs Python on the same data) unless noted.

## Functions called by the app (`/rest/v1/rpc/<name>`)

| SQL function | Python |
|---|---|
| `_distance_km` | `ejb.services.tables._distance_km` (anon allowed) |
| `_is_lesson_student` | `ejb.services.tables._is_lesson_student` (anon allowed) |
| `_is_lesson_tutor` | `ejb.services.tables._is_lesson_tutor` (anon allowed) |
| `_is_table_participant` | `ejb.services.tables._is_table_participant` |
| `_kosovo_now` | `ejb.services.tables._kosovo_now` (anon allowed) |
| `_month_start` | `ejb.services.tables._month_start` (anon allowed) |
| `_my_hosted_table_ids` | `ejb.services.basics._my_hosted_table_ids` (anon allowed) |
| `_my_table_ids` | `ejb.services.basics._my_table_ids` (anon allowed) |
| `_new_share_code` | `ejb.services.tables._new_share_code` |
| `_next_wednesday_dinner` | `ejb.services.tables._next_wednesday_dinner` (anon allowed) |
| `_viewer_home_city` | `ejb.services.basics._viewer_home_city` (anon allowed) |
| `_viewer_sees_all_cities` | `ejb.services.basics._viewer_sees_all_cities` (anon allowed) |
| `admin_ban_from_report` | `ejb.services.admin_actions.admin_ban_from_report` |
| `admin_ban_user` | `ejb.services.admin_actions.admin_ban_user` |
| `admin_cancel_order` | `ejb.services.plans.admin_cancel_order` |
| `admin_cancel_table` | `ejb.services.admin_actions.admin_cancel_table` |
| `admin_delete_immediately` | `ejb.services.admin_actions.admin_delete_immediately` |
| `admin_delete_user` | `ejb.services.admin_actions.admin_delete_user` |
| `admin_dismiss_report` | `ejb.services.admin_actions.admin_dismiss_report` |
| `admin_form_wednesday` | `ejb.services.wednesday.admin_form_wednesday` |
| `admin_get_dashboard` | `ejb.services.admin_views.admin_get_dashboard` |
| `admin_get_http_responses` | `ejb.services.admin_views.admin_get_http_responses` |
| `admin_get_reports` | `ejb.services.admin_views.admin_get_reports` |
| `admin_get_stats` | `ejb.services.admin_views.admin_get_stats` |
| `admin_get_table` | `ejb.services.admin_views.admin_get_table` |
| `admin_get_user` | `ejb.services.admin_views.admin_get_user` |
| `admin_global_search` | `ejb.services.admin_views.admin_global_search` |
| `admin_grant_premium` | `ejb.services.plans.admin_grant_premium` |
| `admin_list_audit` | `ejb.services.admin_views.admin_list_audit` |
| `admin_list_bans` | `ejb.services.admin_views.admin_list_bans` |
| `admin_list_payments` | `ejb.services.admin_views.admin_list_payments` |
| `admin_list_reports` | `ejb.services.admin_views.admin_list_reports` |
| `admin_list_tables` | `ejb.services.admin_views.admin_list_tables` |
| `admin_list_tutors` | `ejb.services.lessons.admin_list_tutors` |
| `admin_list_users` | `ejb.services.admin_views.admin_list_users` |
| `admin_list_wednesday` | `ejb.services.wednesday.admin_list_wednesday` |
| `admin_mark_order_paid` | `ejb.services.plans.admin_mark_order_paid` |
| `admin_notify_user` | `ejb.services.admin_actions.admin_notify_user` |
| `admin_plans_overview` | `ejb.services.plans.admin_plans_overview` |
| `admin_reactivate_account` | `ejb.services.admin_actions.admin_reactivate_account` |
| `admin_restore_table` | `ejb.services.admin_actions.admin_restore_table` |
| `admin_review_tutor` | `ejb.services.lessons.admin_review_tutor` |
| `admin_revoke_premium` | `ejb.services.plans.admin_revoke_premium` |
| `admin_set_restaurant_active` | `ejb.services.wednesday.admin_set_restaurant_active` |
| `admin_set_user_admin` | `ejb.services.admin_actions.admin_set_user_admin` |
| `admin_set_user_deactivated` | `ejb.services.admin_actions.admin_set_user_deactivated` |
| `admin_update_plan` | `ejb.services.plans.admin_update_plan` |
| `admin_upsert_restaurant` | `ejb.services.wednesday.admin_upsert_restaurant` |
| `admin_wednesday_signups` | `ejb.services.wednesday.admin_wednesday_signups` |
| `approve_request` | `ejb.services.tables.approve_request` (anon allowed) |
| `award_badge` | `ejb.services.tables.award_badge` |
| `book_lesson` | `ejb.services.lessons.book_lesson` |
| `can_see_city` | `ejb.services.basics.can_see_city` |
| `cancel_lesson` | `ejb.services.lessons.cancel_lesson` |
| `cancel_premium_order` | `ejb.services.plans.cancel_premium_order` |
| `cancel_wednesday_signup` | `ejb.services.wednesday.cancel_wednesday_signup` |
| `complete_onboarding` | `ejb.services.tables.complete_onboarding` |
| `confirm_free_seat` | `ejb.services.tables.confirm_free_seat` (anon allowed) |
| `confirm_lesson_seat` | `ejb.services.lessons.confirm_lesson_seat` |
| `create_group_lesson` | `ejb.services.lessons.create_group_lesson` |
| `create_wednesday_dinner_group` | `ejb.services.wednesday.create_wednesday_dinner_group` (anon allowed) |
| `form_due_wednesday_groups` | `ejb.services.wednesday.form_due_wednesday_groups` |
| `get_lesson_room` | `ejb.services.lessons.get_lesson_room` |
| `get_my_wednesday_groups` | `ejb.services.wednesday.get_my_wednesday_groups` (anon allowed) |
| `get_wednesday_restaurant` | `ejb.services.wednesday.get_wednesday_restaurant` (anon allowed) |
| `is_admin_user` | `ejb.services.basics.is_admin_user` (anon allowed) |
| `is_premium` | `ejb.services.basics.is_premium` |
| `join_group_lesson` | `ejb.services.lessons.join_group_lesson` |
| `leave_table` | `ejb.services.tables.leave_table` (anon allowed) |
| `list_group_lessons` | `ejb.services.lessons.list_group_lessons` |
| `list_tutors` | `ejb.services.lessons.list_tutors` |
| `my_lessons` | `ejb.services.lessons.my_lessons` |
| `my_plan` | `ejb.services.plans.my_plan` |
| `my_wednesday` | `ejb.services.wednesday.my_wednesday` |
| `reject_request` | `ejb.services.tables.reject_request` (anon allowed) |
| `request_join` | `ejb.services.tables.request_join` |
| `request_premium` | `ejb.services.plans.request_premium` |
| `respond_lesson_request` | `ejb.services.lessons.respond_lesson_request` |
| `set_home_city` | `ejb.services.tables.set_home_city` |
| `signup_wednesday` | `ejb.services.wednesday.signup_wednesday` |
| `table_share_preview` | `ejb.services.tables.table_share_preview` (anon allowed) |

## Internal helper functions

| SQL function | Python |
|---|---|
| `_admin_guard` | common.admin_guard |
| `_admin_log` | common.admin_log |
| `_admin_service_key` | — (only built HTTP headers for Edge Functions; not needed) |
| `_admin_user_label` | common.user_label |
| `_backend_http_post` | ejb/jobs.py enqueue() |
| `_form_wednesday_groups` | services/wednesday.py |
| `_grant_premium` | services/plans.py |
| `_lesson_notify` | services/lessons.py |
| `_premium_until` | common.premium_until |
| `_require_onboarded_me` | common.require_onboarded_me |
| `activate_subscription` | services/plans.py |
| `ban_user` | services/admin_actions.py |
| `confirm_paid_seat` | services/tables.py |
| `notification_classify` | hooks.classify |

## Triggers → model hooks (`ejb/hooks.py`, wired in `ejb/signals.py`)

| Table | SQL trigger (function) | Python |
|---|---|---|
| auth.users | `on_auth_user_created` (`handle_new_user`) | `hooks.user_created` |
| profiles | `trg_profiles_fill_oauth_names` | `hooks.profile_before_insert` |
| profiles | `trg_prevent_reactivation`, `trg_profiles_protect_onboarded_at` | `hooks.profile_before_update` |
| tables | `trg_enforce_plan_tables`, `trg_tables_require_onboarded` | `hooks.table_before_insert` |
| tables | `trg_tables_keep_share_code` | `hooks.table_before_update` |
| tables | `trg_bump_hosted`, `trg_host_member` | `hooks.table_after_insert` |
| requests | `trg_enforce_plan_requests`, `trg_requests_require_onboarded` | `hooks.join_before_insert` |
| requests | `trg_notify_request`, `trg_email_request` (production only), `trg_requests_touch_table*` | `hooks.request_after_save`, `touch_table` |
| waitlist | `trg_enforce_plan_waitlist`, `trg_waitlist_require_onboarded` | `hooks.join_before_insert` |
| memberships | `trg_memberships_touch_table`, `trg_waitlist_leave` (`notify_waitlist_on_leave`) | `hooks.touch_table`, `hooks.membership_after_delete` |
| notifications | `trg_notifications_tag_kind` | `hooks.notification_before_insert` (+ `classify`) |
| payments | `trg_payments_fill_snapshot` | `hooks.payment_before_insert` |
| ratings | `trg_apply_rating` | `hooks.rating_after_insert` |
| connection_picks | `trg_mutual_pick` | `hooks.pick_after_insert` |
| tutors | `trg_tutors_before_write` | `hooks.tutor_before_write` |
| 7 live tables | `trg_realtime_notify` (`backend.realtime_notify`) | `ejb/realtime.py` (sent after commit) |
| backend.jobs | `trg_jobs_notify` | `ejb/jobs.py` wakes the worker through Redis |

## Row-level security policies → `ejb/policies.py`

All policies (incl. the restrictive `tables_plan_city`) are rules per table in
`RULES`, applied by the query engine (`ejb/query.py`) to reads, embedded rows,
inserts (WITH CHECK after the hooks), updates and deletes, and by the realtime
permission check. Tables with RLS and no policy (lesson_rooms, notification_*)
deny all direct access, as before.

## Other database-side pieces

| Old | Now |
|---|---|
| pg_cron `form-wednesday-groups` (`5 * * * *`) | scheduler in `core/realtime.py` (hourly at :05, one process via Redis lock) / `manage.py form_wednesday_groups` |
| `net.http_post` → Edge Functions | `ejb/jobs.py` + worker `core/jobs.py` |
| NOTIFY listener for realtime | removed (Python publishes after commit) |
| pgcrypto `crypt()` for passwords | `bcrypt` package (`core/passwords.py`); pgcrypto only if bcrypt is not installed |
| schema (tables, constraints, indexes) | Django models + migrations `ejb/migrations/0001..0003` |
| seed rows from SQL migrations (plans, subjects, notification rules/labels, restaurants) | `ejb/reference_data.py`, loaded by migrations |
| data backfills of the 2026-10-03 SQL migrations | `ejb/data_migrations.py` (migration 0002) |
| PostgREST / SQL generation | `ejb/query.py` on the ORM; no raw SQL in request handling |

## Intentional changes (security fixes)

| Old behaviour | Now |
|---|---|
| `approve_request` worked signed out (NULL comparison) | refused unless you are the host |
| a user could set any status on their own join request (e.g. self-approve) | only approved → confirmed |
| a user could update any column of their own profile (incl. `is_admin`, rating, counters, home city) | those columns are kept; the app's own updates are unaffected |
| signed-out writes failed with an odd "permission denied for function" | plain access refusal |
