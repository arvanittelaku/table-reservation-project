-- ═══════════════════════════════════════════════════════════════════
--  Admin panel v2: full visibility (users, tables, payments, Wednesday),
--  moderation actions, and an audit log of every admin action.
--
--  Every function here is SECURITY DEFINER and starts with the
--  public._admin_guard() check, so a non-admin calling any RPC gets an
--  exception before anything is read or written.
--
--  Existing functions that are redefined below keep their exact logic
--  (admin_dismiss_report, admin_ban_from_report, admin_delete_immediately);
--  the only addition is an audit-log row, and admin_delete_immediately now
--  reads the service key from vault like ban_user does.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────── 0. Payment records survive deletions ─────────────────────────
-- payments.user_id / payments.table_id referenced profiles/tables with no ON DELETE
-- rule, so deleting a user who ever paid (or a table with payments) failed with a
-- foreign-key error. Payment rows are financial records: keep them, null the link.
ALTER TABLE public.payments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.payments ALTER COLUMN table_id DROP NOT NULL;

-- Drop whatever FK currently guards these columns (name-independent), then re-add.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.payments'::regclass
      AND con.contype = 'f'
      AND att.attname IN ('user_id', 'table_id')
  LOOP
    EXECUTE format('ALTER TABLE public.payments DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_table_id_fkey
  FOREIGN KEY (table_id) REFERENCES public.tables(id) ON DELETE SET NULL;

-- Snapshot columns so a payment row still says who/what after the link is nulled.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payer_name text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS table_title text;

UPDATE public.payments pay
SET payer_name = COALESCE(pay.payer_name, trim(p.first_name || ' ' || p.last_name))
FROM public.profiles p
WHERE p.id = pay.user_id AND pay.payer_name IS NULL;

UPDATE public.payments pay
SET table_title = COALESCE(pay.table_title, t.title)
FROM public.tables t
WHERE t.id = pay.table_id AND pay.table_title IS NULL;

CREATE OR REPLACE FUNCTION public.payments_fill_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payer_name IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT trim(first_name || ' ' || last_name) INTO NEW.payer_name
    FROM public.profiles WHERE id = NEW.user_id;
  END IF;
  IF NEW.table_title IS NULL AND NEW.table_id IS NOT NULL THEN
    SELECT title INTO NEW.table_title FROM public.tables WHERE id = NEW.table_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_fill_snapshot ON public.payments;
CREATE TRIGGER trg_payments_fill_snapshot
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_fill_snapshot();

CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments (created_at);
CREATE INDEX IF NOT EXISTS idx_payments_table ON public.payments (table_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON public.reports (reported_id);
CREATE INDEX IF NOT EXISTS idx_bans_user ON public.bans (user_id);

-- ───────────────────────── 1. Audit log ─────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          bigserial PRIMARY KEY,
  admin_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_name  text,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   uuid,
  target_label text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_log (created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_audit_select_admin ON public.admin_audit_log;
CREATE POLICY admin_audit_select_admin ON public.admin_audit_log
  FOR SELECT TO authenticated USING (public.is_admin_user());
-- No INSERT/UPDATE/DELETE policies: rows are written only by the definer functions below.

-- ───────────────────────── 2. Internal helpers ─────────────────────────
CREATE OR REPLACE FUNCTION public._admin_guard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta bëjnë këtë' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_log(
  p_action text, p_target_type text, p_target_id uuid, p_target_label text, p_details jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_audit_log (admin_id, admin_name, action, target_type, target_id, target_label, details)
  SELECT auth.uid(), trim(p.first_name || ' ' || p.last_name), p_action, p_target_type,
         p_target_id, p_target_label, COALESCE(p_details, '{}'::jsonb)
  FROM (SELECT 1) one
  LEFT JOIN public.profiles p ON p.id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_service_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'app_service_key'
  LIMIT 1;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := current_setting('app.service_key', true);
  END IF;
  RETURN v_key;
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_user_label(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT trim(first_name || ' ' || last_name) FROM public.profiles WHERE id = p_user
$$;

REVOKE ALL ON FUNCTION public._admin_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_log(text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_service_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_user_label(uuid) FROM PUBLIC, anon, authenticated;

-- ───────────────────────── 3. Dashboard ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_dashboard(p_range text DEFAULT 'month')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_range text := CASE WHEN p_range IN ('day', 'month', 'year') THEN p_range ELSE 'month' END;
  v_since timestamptz;
  v_today timestamptz := date_trunc('day', now());
BEGIN
  PERFORM public._admin_guard();

  v_since := now() - CASE v_range
    WHEN 'day' THEN interval '30 days'
    WHEN 'year' THEN interval '5 years'
    ELSE interval '12 months'
  END;

  RETURN jsonb_build_object(
    'range', v_range,
    'generated_at', now(),
    'totals', jsonb_build_object(
      'users_total',        (SELECT count(*) FROM public.profiles),
      'users_today',        (SELECT count(*) FROM public.profiles WHERE created_at >= v_today),
      'users_7d',           (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '7 days'),
      'users_30d',          (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '30 days'),
      'users_deactivated',  (SELECT count(*) FROM public.profiles WHERE deactivated_at IS NOT NULL),
      'users_unconfirmed',  (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NULL),
      'users_active_7d',    (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '7 days'),
      'admins',             (SELECT count(*) FROM public.profiles WHERE is_admin),
      'tables_total',       (SELECT count(*) FROM public.tables),
      'tables_upcoming',    (SELECT count(*) FROM public.tables WHERE status IN ('open', 'full') AND event_datetime > now()),
      'tables_today',       (SELECT count(*) FROM public.tables WHERE created_at >= v_today),
      'tables_cancelled',   (SELECT count(*) FROM public.tables WHERE status = 'cancelled'),
      'seats_taken',        (SELECT count(*) FROM public.memberships WHERE role = 'member'),
      'requests_pending',   (SELECT count(*) FROM public.requests r JOIN public.tables t ON t.id = r.table_id
                              WHERE r.status = 'pending' AND t.event_datetime > now()),
      'requests_awaiting_payment', (SELECT count(*) FROM public.requests r JOIN public.tables t ON t.id = r.table_id
                              WHERE r.status = 'approved' AND t.event_datetime > now()),
      'payments_count',     (SELECT count(*) FROM public.payments WHERE status = 'paid'),
      'revenue_total_cents',(SELECT COALESCE(sum(amount_cents), 0) FROM public.payments WHERE status = 'paid'),
      'revenue_today_cents',(SELECT COALESCE(sum(amount_cents), 0) FROM public.payments WHERE status = 'paid' AND created_at >= v_today),
      'revenue_30d_cents',  (SELECT COALESCE(sum(amount_cents), 0) FROM public.payments WHERE status = 'paid' AND created_at >= now() - interval '30 days'),
      'payments_stub',      (SELECT count(*) FROM public.payments WHERE provider = 'stub'),
      'reports_pending',    (SELECT count(*) FROM public.reports WHERE status = 'pending'),
      'reports_total',      (SELECT count(*) FROM public.reports),
      'bans_total',         (SELECT count(*) FROM public.bans),
      'banned_users',       (SELECT count(DISTINCT user_id) FROM public.bans),
      'wednesday_upcoming', (SELECT count(*) FROM public.wednesday_groups WHERE dinner_date > now()),
      'wednesday_participants', (SELECT count(*) FROM public.wednesday_participants wp
                              JOIN public.wednesday_groups g ON g.id = wp.group_id WHERE g.dinner_date > now())
    ),
    'series', jsonb_build_object(
      'new_users', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('period', period, 'count', cnt) ORDER BY period), '[]'::jsonb)
        FROM (SELECT date_trunc(v_range, created_at) AS period, count(*) AS cnt
              FROM public.profiles WHERE created_at >= v_since GROUP BY 1) x
      ),
      'tables_opened', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('period', period, 'count', cnt) ORDER BY period), '[]'::jsonb)
        FROM (SELECT date_trunc(v_range, created_at) AS period, count(*) AS cnt
              FROM public.tables WHERE created_at >= v_since GROUP BY 1) x
      ),
      'seats_taken', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('period', period, 'count', cnt) ORDER BY period), '[]'::jsonb)
        FROM (SELECT date_trunc(v_range, joined_at) AS period, count(*) AS cnt
              FROM public.memberships WHERE role = 'member' AND joined_at >= v_since GROUP BY 1) x
      ),
      'revenue', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('period', period, 'count', cents) ORDER BY period), '[]'::jsonb)
        FROM (SELECT date_trunc(v_range, created_at) AS period, sum(amount_cents) AS cents
              FROM public.payments WHERE status = 'paid' AND created_at >= v_since GROUP BY 1) x
      )
    ),
    'by_city', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('city', city, 'tables', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (SELECT city, count(*) AS cnt FROM public.tables GROUP BY city ORDER BY count(*) DESC LIMIT 8) x
    ),
    'by_kind', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'tables', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (SELECT kind, count(*) AS cnt FROM public.tables GROUP BY kind) x
    ),
    'recent_users', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT p.id, p.first_name, p.last_name, p.photo_path, p.created_at, u.email
            FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
            ORDER BY p.created_at DESC LIMIT 6) x
    ),
    'upcoming_tables', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.event_datetime ASC), '[]'::jsonb)
      FROM (SELECT t.id, t.title, t.city, t.kind, t.event_datetime, t.spots, t.status,
                   (SELECT count(*) FROM public.memberships m WHERE m.table_id = t.id) AS seated
            FROM public.tables t
            WHERE t.status IN ('open', 'full') AND t.event_datetime > now()
            ORDER BY t.event_datetime ASC LIMIT 6) x
    ),
    'recent_payments', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT pay.id, pay.amount_cents, pay.currency, pay.status, pay.provider, pay.ticket_code,
                   pay.created_at, pay.user_id, pay.table_id,
                   COALESCE(trim(p.first_name || ' ' || p.last_name), pay.payer_name) AS payer_name,
                   COALESCE(t.title, pay.table_title) AS table_title
            FROM public.payments pay
            LEFT JOIN public.profiles p ON p.id = pay.user_id
            LEFT JOIN public.tables t ON t.id = pay.table_id
            ORDER BY pay.created_at DESC LIMIT 6) x
    )
  );
END;
$$;

-- ───────────────────────── 4. Users ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_sort   text DEFAULT 'newest',
  p_limit  int  DEFAULT 25,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_limit int := greatest(1, least(COALESCE(p_limit, 25), 100));
  v_offset int := greatest(0, COALESCE(p_offset, 0));
  v_result jsonb;
BEGIN
  PERFORM public._admin_guard();

  WITH base AS (
    SELECT
      p.id, p.first_name, p.last_name, p.age, p.photo_path, p.is_tourist, p.from_place,
      p.verified, p.rating, p.is_admin, p.deactivated_at, p.created_at,
      u.email, u.last_sign_in_at, u.email_confirmed_at,
      (SELECT count(*) FROM public.tables t WHERE t.host_id = p.id) AS hosted_count,
      (SELECT count(*) FROM public.memberships m WHERE m.user_id = p.id AND m.role = 'member') AS joined_count,
      (SELECT count(*) FROM public.payments pay WHERE pay.user_id = p.id AND pay.status = 'paid') AS payments_count,
      (SELECT COALESCE(sum(pay.amount_cents), 0) FROM public.payments pay WHERE pay.user_id = p.id AND pay.status = 'paid') AS paid_cents,
      (SELECT count(*) FROM public.bans b WHERE b.user_id = p.id) AS bans_count,
      (SELECT count(*) FROM public.reports r WHERE r.reported_id = p.id) AS reports_against,
      (SELECT count(*) FROM public.reports r WHERE r.reported_id = p.id AND r.status = 'pending') AS reports_pending,
      (SELECT count(*) FROM public.blocks bl WHERE bl.blocked_id = p.id) AS blocked_by_count
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
  ),
  filtered AS (
    SELECT b.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN p_sort = 'oldest' THEN b.created_at END ASC,
          CASE WHEN p_sort = 'name' THEN lower(b.first_name || ' ' || b.last_name) END ASC,
          CASE WHEN p_sort = 'last_active' THEN b.last_sign_in_at END DESC NULLS LAST,
          CASE WHEN p_sort = 'most_hosted' THEN b.hosted_count END DESC,
          CASE WHEN p_sort = 'most_joined' THEN b.joined_count END DESC,
          CASE WHEN p_sort = 'most_paid' THEN b.paid_cents END DESC,
          CASE WHEN p_sort = 'most_reported' THEN b.reports_against END DESC,
          b.created_at DESC
      ) AS rn
    FROM base b
    WHERE (
        v_q IS NULL
        OR (b.first_name || ' ' || b.last_name) ILIKE '%' || v_q || '%'
        OR b.email ILIKE '%' || v_q || '%'
        OR b.id::text = v_q
      )
      AND CASE COALESCE(p_status, 'all')
        WHEN 'active'      THEN b.deactivated_at IS NULL
        WHEN 'deactivated' THEN b.deactivated_at IS NOT NULL
        WHEN 'admin'       THEN b.is_admin
        WHEN 'banned'      THEN b.bans_count > 0
        WHEN 'reported'    THEN b.reports_pending > 0
        WHEN 'unconfirmed' THEN b.email_confirmed_at IS NULL
        WHEN 'paying'      THEN b.payments_count > 0
        WHEN 'hosts'       THEN b.hosted_count > 0
        ELSE true
      END
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) - 'rn' ORDER BY f.rn)
      FROM filtered f
      WHERE f.rn > v_offset AND f.rn <= v_offset + v_limit
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_user(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_profile jsonb;
BEGIN
  PERFORM public._admin_guard();

  SELECT to_jsonb(x) INTO v_profile
  FROM (
    SELECT p.id, p.first_name, p.last_name, p.age, p.photo_path, p.photo_face_ok, p.is_tourist,
           p.from_place, p.langs, p.verified, p.rating, p.is_admin, p.deactivated_at, p.created_at,
           u.email, u.last_sign_in_at, u.email_confirmed_at, u.created_at AS auth_created_at
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_user
  ) x;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Përdoruesi nuk u gjet';
  END IF;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'counts', jsonb_build_object(
      'hosted',          (SELECT count(*) FROM public.tables WHERE host_id = p_user),
      'joined',          (SELECT count(*) FROM public.memberships WHERE user_id = p_user AND role = 'member'),
      'requests',        (SELECT count(*) FROM public.requests WHERE user_id = p_user),
      'payments',        (SELECT count(*) FROM public.payments WHERE user_id = p_user AND status = 'paid'),
      'paid_cents',      (SELECT COALESCE(sum(amount_cents), 0) FROM public.payments WHERE user_id = p_user AND status = 'paid'),
      'messages',        (SELECT count(*) FROM public.messages WHERE sender_id = p_user),
      'ratings_given',   (SELECT count(*) FROM public.ratings WHERE rater_id = p_user),
      'connections',     (SELECT count(*) FROM public.connections WHERE a = p_user OR b = p_user),
      'blocked_by',      (SELECT count(*) FROM public.blocks WHERE blocked_id = p_user),
      'blocking',        (SELECT count(*) FROM public.blocks WHERE blocker_id = p_user),
      'reports_against', (SELECT count(*) FROM public.reports WHERE reported_id = p_user),
      'reports_made',    (SELECT count(*) FROM public.reports WHERE reporter_id = p_user),
      'bans',            (SELECT count(*) FROM public.bans WHERE user_id = p_user)
    ),
    'hosted_tables', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.event_datetime DESC), '[]'::jsonb)
      FROM (SELECT t.id, t.title, t.kind, t.city, t.status, t.event_datetime, t.spots, t.created_at,
                   (SELECT count(*) FROM public.memberships m WHERE m.table_id = t.id AND m.role = 'member') AS guests
            FROM public.tables t WHERE t.host_id = p_user
            ORDER BY t.event_datetime DESC LIMIT 50) x
    ),
    'joined_tables', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.joined_at DESC), '[]'::jsonb)
      FROM (SELECT t.id, t.title, t.kind, t.city, t.status, t.event_datetime, m.joined_at,
                   trim(h.first_name || ' ' || h.last_name) AS host_name,
                   pay.amount_cents, pay.ticket_code, pay.status AS payment_status
            FROM public.memberships m
            JOIN public.tables t ON t.id = m.table_id
            LEFT JOIN public.profiles h ON h.id = t.host_id
            LEFT JOIN public.payments pay ON pay.table_id = t.id AND pay.user_id = m.user_id
            WHERE m.user_id = p_user AND m.role = 'member'
            ORDER BY m.joined_at DESC LIMIT 50) x
    ),
    'requests', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT r.id, r.status, r.created_at, t.id AS table_id, t.title AS table_title, t.event_datetime
            FROM public.requests r JOIN public.tables t ON t.id = r.table_id
            WHERE r.user_id = p_user
            ORDER BY r.created_at DESC LIMIT 50) x
    ),
    'payments', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT pay.id, pay.amount_cents, pay.currency, pay.status, pay.provider, pay.provider_ref,
                   pay.ticket_code, pay.created_at, pay.table_id,
                   COALESCE(t.title, pay.table_title) AS table_title
            FROM public.payments pay LEFT JOIN public.tables t ON t.id = pay.table_id
            WHERE pay.user_id = p_user
            ORDER BY pay.created_at DESC LIMIT 100) x
    ),
    'reports_against', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT r.id, r.reason, r.details, r.status, r.created_at, r.reporter_id,
                   trim(pr.first_name || ' ' || pr.last_name) AS reporter_name, t.title AS table_title
            FROM public.reports r
            LEFT JOIN public.profiles pr ON pr.id = r.reporter_id
            LEFT JOIN public.tables t ON t.id = r.table_id
            WHERE r.reported_id = p_user
            ORDER BY r.created_at DESC LIMIT 50) x
    ),
    'reports_made', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT r.id, r.reason, r.status, r.created_at, r.reported_id,
                   trim(pd.first_name || ' ' || pd.last_name) AS reported_name
            FROM public.reports r
            LEFT JOIN public.profiles pd ON pd.id = r.reported_id
            WHERE r.reporter_id = p_user
            ORDER BY r.created_at DESC LIMIT 50) x
    ),
    'bans', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT b.id, b.reason, b.created_at FROM public.bans b WHERE b.user_id = p_user) x
    ),
    'audit', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT a.id, a.action, a.admin_name, a.details, a.created_at
            FROM public.admin_audit_log a
            WHERE a.target_type = 'user' AND a.target_id = p_user
            ORDER BY a.created_at DESC LIMIT 30) x
    )
  );
END;
$$;

-- ───────────────────────── 5. Tables ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_tables(
  p_search text DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_kind   text DEFAULT NULL,
  p_city   text DEFAULT NULL,
  p_sort   text DEFAULT 'newest',
  p_limit  int  DEFAULT 25,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_kind text := NULLIF(trim(COALESCE(p_kind, '')), '');
  v_city text := NULLIF(trim(COALESCE(p_city, '')), '');
  v_limit int := greatest(1, least(COALESCE(p_limit, 25), 100));
  v_offset int := greatest(0, COALESCE(p_offset, 0));
  v_result jsonb;
BEGIN
  PERFORM public._admin_guard();

  WITH base AS (
    SELECT
      t.id, t.title, t.kind, t.category, t.city, t.to_city, t.area, t.time_label,
      t.event_datetime, t.created_at, t.status, t.spots, t.women_only, t.men_only,
      t.mystery, t.maps_link, t.host_id,
      trim(h.first_name || ' ' || h.last_name) AS host_name, h.photo_path AS host_photo_path,
      (t.event_datetime <= now()) AS is_past,
      (SELECT count(*) FROM public.memberships m WHERE m.table_id = t.id AND m.role = 'member') AS guests,
      (SELECT count(*) FROM public.memberships m WHERE m.table_id = t.id) AS seated,
      (SELECT count(*) FROM public.requests r WHERE r.table_id = t.id AND r.status = 'pending') AS pending_requests,
      (SELECT count(*) FROM public.requests r WHERE r.table_id = t.id AND r.status = 'approved') AS awaiting_payment,
      (SELECT count(*) FROM public.waitlist w WHERE w.table_id = t.id) AS waitlist_count,
      (SELECT count(*) FROM public.payments pay WHERE pay.table_id = t.id AND pay.status = 'paid') AS paid_count,
      (SELECT COALESCE(sum(pay.amount_cents), 0) FROM public.payments pay WHERE pay.table_id = t.id AND pay.status = 'paid') AS revenue_cents,
      (SELECT count(*) FROM public.messages msg WHERE msg.table_id = t.id) AS messages_count,
      (SELECT count(*) FROM public.reports rep WHERE rep.table_id = t.id) AS reports_count
    FROM public.tables t
    LEFT JOIN public.profiles h ON h.id = t.host_id
  ),
  filtered AS (
    SELECT b.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN p_sort = 'oldest' THEN b.created_at END ASC,
          CASE WHEN p_sort = 'event_asc' THEN b.event_datetime END ASC,
          CASE WHEN p_sort = 'event_desc' THEN b.event_datetime END DESC,
          CASE WHEN p_sort = 'most_guests' THEN b.guests END DESC,
          CASE WHEN p_sort = 'most_revenue' THEN b.revenue_cents END DESC,
          CASE WHEN p_sort = 'most_requests' THEN b.pending_requests END DESC,
          b.created_at DESC
      ) AS rn
    FROM base b
    WHERE (
        v_q IS NULL
        OR b.title ILIKE '%' || v_q || '%'
        OR b.city ILIKE '%' || v_q || '%'
        OR COALESCE(b.area, '') ILIKE '%' || v_q || '%'
        OR COALESCE(b.host_name, '') ILIKE '%' || v_q || '%'
        OR b.id::text = v_q
        OR b.host_id::text = v_q
      )
      AND (v_kind IS NULL OR b.kind = v_kind)
      AND (v_city IS NULL OR b.city = v_city)
      AND CASE COALESCE(p_status, 'all')
        WHEN 'upcoming'  THEN b.status IN ('open', 'full') AND NOT b.is_past
        WHEN 'past'      THEN b.is_past AND b.status <> 'cancelled'
        WHEN 'full'      THEN b.status = 'full' OR (b.seated >= b.spots AND b.status <> 'cancelled')
        WHEN 'cancelled' THEN b.status = 'cancelled'
        WHEN 'reported'  THEN b.reports_count > 0
        WHEN 'paid'      THEN b.paid_count > 0
        ELSE true
      END
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'cities', (SELECT COALESCE(jsonb_agg(DISTINCT city), '[]'::jsonb) FROM public.tables),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) - 'rn' ORDER BY f.rn)
      FROM filtered f
      WHERE f.rn > v_offset AND f.rn <= v_offset + v_limit
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_table(p_table uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_table jsonb;
BEGIN
  PERFORM public._admin_guard();

  SELECT to_jsonb(x) INTO v_table
  FROM (
    SELECT t.*, trim(h.first_name || ' ' || h.last_name) AS host_name, h.photo_path AS host_photo_path,
           hu.email AS host_email, (t.event_datetime <= now()) AS is_past
    FROM public.tables t
    LEFT JOIN public.profiles h ON h.id = t.host_id
    LEFT JOIN auth.users hu ON hu.id = t.host_id
    WHERE t.id = p_table
  ) x;

  IF v_table IS NULL THEN
    RAISE EXCEPTION 'Tavolina nuk u gjet';
  END IF;

  RETURN jsonb_build_object(
    'table', v_table,
    'members', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY (x.role = 'host') DESC, x.joined_at ASC), '[]'::jsonb)
      FROM (SELECT m.user_id, m.role, m.joined_at, p.first_name, p.last_name, p.photo_path, p.age, u.email,
                   pay.id AS payment_id, pay.amount_cents, pay.status AS payment_status,
                   pay.ticket_code, pay.provider, pay.created_at AS paid_at
            FROM public.memberships m
            JOIN public.profiles p ON p.id = m.user_id
            LEFT JOIN auth.users u ON u.id = m.user_id
            LEFT JOIN public.payments pay ON pay.table_id = m.table_id AND pay.user_id = m.user_id
            WHERE m.table_id = p_table) x
    ),
    'requests', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT r.id, r.user_id, r.status, r.created_at, p.first_name, p.last_name, p.photo_path, p.age
            FROM public.requests r JOIN public.profiles p ON p.id = r.user_id
            WHERE r.table_id = p_table) x
    ),
    'waitlist', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at ASC), '[]'::jsonb)
      FROM (SELECT w.user_id, w.created_at, p.first_name, p.last_name
            FROM public.waitlist w JOIN public.profiles p ON p.id = w.user_id
            WHERE w.table_id = p_table) x
    ),
    'payments', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT pay.id, pay.user_id, pay.amount_cents, pay.currency, pay.status, pay.provider,
                   pay.provider_ref, pay.ticket_code, pay.created_at,
                   COALESCE(trim(p.first_name || ' ' || p.last_name), pay.payer_name) AS payer_name
            FROM public.payments pay LEFT JOIN public.profiles p ON p.id = pay.user_id
            WHERE pay.table_id = p_table) x
    ),
    'reports', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT r.id, r.reason, r.status, r.created_at,
                   trim(pr.first_name || ' ' || pr.last_name) AS reporter_name,
                   trim(pd.first_name || ' ' || pd.last_name) AS reported_name, r.reported_id
            FROM public.reports r
            LEFT JOIN public.profiles pr ON pr.id = r.reporter_id
            LEFT JOIN public.profiles pd ON pd.id = r.reported_id
            WHERE r.table_id = p_table) x
    ),
    'chat', jsonb_build_object(
      'messages', (SELECT count(*) FROM public.messages WHERE table_id = p_table),
      'last_message_at', (SELECT max(created_at) FROM public.messages WHERE table_id = p_table)
    ),
    'audit', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT a.id, a.action, a.admin_name, a.details, a.created_at
            FROM public.admin_audit_log a
            WHERE a.target_type = 'table' AND a.target_id = p_table
            ORDER BY a.created_at DESC LIMIT 30) x
    )
  );
END;
$$;

-- ───────────────────────── 6. Payments ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_payments(
  p_search   text DEFAULT NULL,
  p_status   text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_from     timestamptz DEFAULT NULL,
  p_to       timestamptz DEFAULT NULL,
  p_limit    int DEFAULT 25,
  p_offset   int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_status text := NULLIF(trim(COALESCE(p_status, '')), '');
  v_provider text := NULLIF(trim(COALESCE(p_provider, '')), '');
  v_limit int := greatest(1, least(COALESCE(p_limit, 25), 200));
  v_offset int := greatest(0, COALESCE(p_offset, 0));
  v_result jsonb;
BEGIN
  PERFORM public._admin_guard();

  WITH base AS (
    SELECT pay.id, pay.user_id, pay.table_id, pay.amount_cents, pay.currency, pay.provider,
           pay.provider_ref, pay.status, pay.ticket_code, pay.refundable, pay.created_at,
           COALESCE(trim(p.first_name || ' ' || p.last_name), pay.payer_name) AS payer_name,
           u.email AS payer_email,
           COALESCE(t.title, pay.table_title) AS table_title,
           t.city AS table_city, t.event_datetime AS table_event_datetime,
           trim(h.first_name || ' ' || h.last_name) AS host_name
    FROM public.payments pay
    LEFT JOIN public.profiles p ON p.id = pay.user_id
    LEFT JOIN auth.users u ON u.id = pay.user_id
    LEFT JOIN public.tables t ON t.id = pay.table_id
    LEFT JOIN public.profiles h ON h.id = t.host_id
  ),
  filtered AS (
    SELECT b.*, row_number() OVER (ORDER BY b.created_at DESC) AS rn
    FROM base b
    WHERE (
        v_q IS NULL
        OR COALESCE(b.ticket_code, '') ILIKE '%' || v_q || '%'
        OR b.provider_ref ILIKE '%' || v_q || '%'
        OR COALESCE(b.payer_name, '') ILIKE '%' || v_q || '%'
        OR COALESCE(b.payer_email, '') ILIKE '%' || v_q || '%'
        OR COALESCE(b.table_title, '') ILIKE '%' || v_q || '%'
        OR b.id::text = v_q
        OR COALESCE(b.user_id::text, '') = v_q
        OR COALESCE(b.table_id::text, '') = v_q
      )
      AND (v_status IS NULL OR b.status = v_status)
      AND (v_provider IS NULL OR b.provider = v_provider)
      AND (p_from IS NULL OR b.created_at >= p_from)
      AND (p_to IS NULL OR b.created_at < p_to)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'sum_paid_cents', (SELECT COALESCE(sum(amount_cents), 0) FROM filtered WHERE status = 'paid'),
    'count_paid', (SELECT count(*) FROM filtered WHERE status = 'paid'),
    'providers', (SELECT COALESCE(jsonb_agg(DISTINCT provider), '[]'::jsonb) FROM public.payments),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) - 'rn' ORDER BY f.rn)
      FROM filtered f
      WHERE f.rn > v_offset AND f.rn <= v_offset + v_limit
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ───────────────────────── 7. Reports (richer than admin_get_reports) ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_reports(p_status text DEFAULT 'pending')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_guard();

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT r.id, r.reason, r.details, r.status, r.created_at, r.reviewed_at,
             r.reporter_id, trim(pr.first_name || ' ' || pr.last_name) AS reporter_name, pr.photo_path AS reporter_photo_path,
             r.reported_id, trim(pd.first_name || ' ' || pd.last_name) AS reported_name, pd.photo_path AS reported_photo_path,
             pd.is_admin AS reported_is_admin,
             r.table_id, t.title AS table_title,
             trim(rv.first_name || ' ' || rv.last_name) AS reviewed_by_name,
             (SELECT count(*) FROM public.reports r2 WHERE r2.reported_id = r.reported_id) AS reported_total_reports,
             (SELECT count(*) FROM public.bans b WHERE b.user_id = r.reported_id) AS reported_bans
      FROM public.reports r
      LEFT JOIN public.profiles pr ON pr.id = r.reporter_id
      LEFT JOIN public.profiles pd ON pd.id = r.reported_id
      LEFT JOIN public.profiles rv ON rv.id = r.reviewed_by
      LEFT JOIN public.tables t ON t.id = r.table_id
      WHERE p_status IS NULL OR p_status = 'all' OR r.status = p_status
      ORDER BY r.created_at DESC
      LIMIT 300
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ───────────────────────── 8. Bans ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_bans()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_guard();

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.last_ban_at DESC)
    FROM (
      SELECT b.user_id, trim(p.first_name || ' ' || p.last_name) AS name, p.photo_path,
             p.deactivated_at, u.email,
             count(*) AS ban_count, max(b.created_at) AS last_ban_at,
             (array_agg(b.reason ORDER BY b.created_at DESC))[1] AS last_reason,
             jsonb_agg(jsonb_build_object('id', b.id, 'reason', b.reason, 'created_at', b.created_at)
                       ORDER BY b.created_at DESC) AS history
      FROM public.bans b
      LEFT JOIN public.profiles p ON p.id = b.user_id
      LEFT JOIN auth.users u ON u.id = b.user_id
      GROUP BY b.user_id, p.first_name, p.last_name, p.photo_path, p.deactivated_at, u.email
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ───────────────────────── 9. Wednesday dinner ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_wednesday()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_guard();

  RETURN jsonb_build_object(
    'groups', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.dinner_date DESC), '[]'::jsonb)
      FROM (
        SELECT g.id, g.city, g.dinner_date, g.created_at, g.restaurant_id,
               r.name AS restaurant_name, r.address AS restaurant_address,
               (now() >= g.dinner_date - interval '24 hours') AS revealed,
               (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'user_id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
                         'photo_path', p.photo_path, 'age', p.age)), '[]'::jsonb)
                FROM public.wednesday_participants wp
                JOIN public.profiles p ON p.id = wp.user_id
                WHERE wp.group_id = g.id) AS participants
        FROM public.wednesday_groups g
        LEFT JOIN public.wednesday_restaurants r ON r.id = g.restaurant_id
        ORDER BY g.dinner_date DESC
        LIMIT 200
      ) x
    ),
    'restaurants', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.city, x.name), '[]'::jsonb)
      FROM (
        SELECT r.id, r.name, r.city, r.address, r.maps_link, r.active,
               (SELECT count(*) FROM public.wednesday_groups g WHERE g.restaurant_id = r.id) AS times_used
        FROM public.wednesday_restaurants r
      ) x
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_restaurant_active(p_restaurant uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_name text;
BEGIN
  PERFORM public._admin_guard();
  UPDATE public.wednesday_restaurants SET active = p_active WHERE id = p_restaurant
  RETURNING name INTO v_name;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Restoranti nuk u gjet';
  END IF;
  PERFORM public._admin_log(CASE WHEN p_active THEN 'restaurant_activated' ELSE 'restaurant_deactivated' END,
                            'restaurant', p_restaurant, v_name, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_restaurant(
  p_id uuid, p_name text, p_city text, p_address text, p_maps_link text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public._admin_guard();

  IF char_length(trim(COALESCE(p_name, ''))) < 2 OR char_length(trim(COALESCE(p_city, ''))) < 2
     OR char_length(trim(COALESCE(p_address, ''))) < 2 THEN
    RAISE EXCEPTION 'Emri, qyteti dhe adresa janë të detyrueshme';
  END IF;
  IF NULLIF(trim(COALESCE(p_maps_link, '')), '') IS NOT NULL
     AND p_maps_link !~* '^https?://(www\.)?(google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)' THEN
    RAISE EXCEPTION 'Linku i hartës duhet të jetë link Google Maps';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.wednesday_restaurants (name, city, address, maps_link, active)
    VALUES (trim(p_name), trim(p_city), trim(p_address), NULLIF(trim(COALESCE(p_maps_link, '')), ''), true)
    RETURNING id INTO v_id;
    PERFORM public._admin_log('restaurant_created', 'restaurant', v_id, trim(p_name), '{}'::jsonb);
  ELSE
    UPDATE public.wednesday_restaurants
    SET name = trim(p_name), city = trim(p_city), address = trim(p_address),
        maps_link = NULLIF(trim(COALESCE(p_maps_link, '')), '')
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Restoranti nuk u gjet';
    END IF;
    PERFORM public._admin_log('restaurant_updated', 'restaurant', v_id, trim(p_name), '{}'::jsonb);
  END IF;

  RETURN v_id;
END;
$$;

-- ───────────────────────── 10. Global search ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_global_search(p_q text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_q text := NULLIF(trim(COALESCE(p_q, '')), '');
BEGIN
  PERFORM public._admin_guard();

  IF v_q IS NULL OR char_length(v_q) < 2 THEN
    RETURN jsonb_build_object('users', '[]'::jsonb, 'tables', '[]'::jsonb, 'payments', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'users', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      FROM (SELECT p.id, p.first_name, p.last_name, p.photo_path, u.email, p.deactivated_at, p.is_admin
            FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
            WHERE (p.first_name || ' ' || p.last_name) ILIKE '%' || v_q || '%'
               OR u.email ILIKE '%' || v_q || '%'
               OR p.id::text = v_q
            ORDER BY p.created_at DESC LIMIT 6) x
    ),
    'tables', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      FROM (SELECT t.id, t.title, t.city, t.kind, t.status, t.event_datetime
            FROM public.tables t
            WHERE t.title ILIKE '%' || v_q || '%' OR t.city ILIKE '%' || v_q || '%' OR t.id::text = v_q
            ORDER BY t.created_at DESC LIMIT 6) x
    ),
    'payments', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      FROM (SELECT pay.id, pay.ticket_code, pay.amount_cents, pay.status, pay.created_at, pay.user_id, pay.table_id,
                   COALESCE(trim(p.first_name || ' ' || p.last_name), pay.payer_name) AS payer_name
            FROM public.payments pay LEFT JOIN public.profiles p ON p.id = pay.user_id
            WHERE COALESCE(pay.ticket_code, '') ILIKE '%' || v_q || '%'
               OR pay.provider_ref ILIKE '%' || v_q || '%'
               OR pay.id::text = v_q
            ORDER BY pay.created_at DESC LIMIT 6) x
    )
  );
END;
$$;

-- ───────────────────────── 11. Audit log reader ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_audit(p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := greatest(1, least(COALESCE(p_limit, 50), 200));
  v_offset int := greatest(0, COALESCE(p_offset, 0));
BEGIN
  PERFORM public._admin_guard();

  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.admin_audit_log),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC, x.id DESC)
      FROM (SELECT a.* FROM public.admin_audit_log a
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT v_limit OFFSET v_offset) x
    ), '[]'::jsonb)
  );
END;
$$;

-- ───────────────────────── 12. Actions ─────────────────────────

-- Strike (ban) a user directly, outside the report flow. Same ban_user() as reports use.
CREATE OR REPLACE FUNCTION public.admin_ban_user(p_user uuid, p_reason text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int; v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  PERFORM public._admin_guard();
  IF p_user = auth.uid() THEN
    RAISE EXCEPTION 'Nuk mund ta pezullosh veten';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Shkruaj arsyen';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user) THEN
    RAISE EXCEPTION 'Përdoruesi nuk u gjet';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND is_admin) THEN
    RAISE EXCEPTION 'Hiq fillimisht rolin admin';
  END IF;

  v_count := public.ban_user(p_user, v_reason);
  PERFORM public._admin_log('user_banned', 'user', p_user, public._admin_user_label(p_user),
                            jsonb_build_object('reason', v_reason, 'ban_count', v_count));
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_deactivated(p_user uuid, p_deactivated boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_guard();
  IF p_user = auth.uid() THEN
    RAISE EXCEPTION 'Nuk mund ta ndryshosh llogarinë tënde këtu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user) THEN
    RAISE EXCEPTION 'Përdoruesi nuk u gjet';
  END IF;

  IF p_deactivated THEN
    UPDATE public.profiles SET deactivated_at = COALESCE(deactivated_at, now()) WHERE id = p_user;
  ELSE
    UPDATE public.profiles SET deactivated_at = NULL WHERE id = p_user;
  END IF;

  PERFORM public._admin_log(CASE WHEN p_deactivated THEN 'user_deactivated' ELSE 'user_reactivated' END,
                            'user', p_user, public._admin_user_label(p_user),
                            jsonb_build_object('reason', NULLIF(trim(COALESCE(p_reason, '')), '')));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_admin(p_user uuid, p_is_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_guard();
  IF p_user = auth.uid() AND NOT p_is_admin THEN
    RAISE EXCEPTION 'Nuk mund ta heqësh rolin admin nga vetja';
  END IF;
  UPDATE public.profiles SET is_admin = p_is_admin WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Përdoruesi nuk u gjet';
  END IF;
  PERFORM public._admin_log(CASE WHEN p_is_admin THEN 'admin_granted' ELSE 'admin_revoked' END,
                            'user', p_user, public._admin_user_label(p_user), '{}'::jsonb);
END;
$$;

-- Permanently delete an account (auth user + avatar) through the existing
-- delete-banned-user Edge Function. Async: the Edge Function does the delete.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_reason text := NULLIF(trim(COALESCE(p_reason, '')), ''); v_label text; v_email text;
BEGIN
  PERFORM public._admin_guard();
  IF p_user = auth.uid() THEN
    RAISE EXCEPTION 'Nuk mund ta fshish llogarinë tënde';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Shkruaj arsyen';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND is_admin) THEN
    RAISE EXCEPTION 'Hiq fillimisht rolin admin';
  END IF;

  v_label := public._admin_user_label(p_user);
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'Përdoruesi nuk u gjet';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = p_user;

  PERFORM public._admin_log('user_deleted', 'user', p_user, v_label,
                            jsonb_build_object('reason', v_reason, 'email', v_email));

  PERFORM net.http_post(
    url := 'https://upxxfhvgbmddhyebaiug.supabase.co/functions/v1/delete-banned-user',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public._admin_service_key()
    ),
    body := jsonb_build_object('user_id', p_user)
  );
END;
$$;

-- Cancel a table: notifies seated guests and anyone with an open request,
-- closes those requests. Payments are left as recorded (no-refund policy);
-- the admin can see who paid in the table detail.
CREATE OR REPLACE FUNCTION public.admin_cancel_table(p_table uuid, p_reason text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_status text;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_notified int := 0;
BEGIN
  PERFORM public._admin_guard();
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Shkruaj arsyen';
  END IF;

  SELECT title, status INTO v_title, v_status FROM public.tables WHERE id = p_table;
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'Tavolina nuk u gjet';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Tavolina është anuluar tashmë';
  END IF;

  UPDATE public.tables SET status = 'cancelled' WHERE id = p_table;

  WITH recipients AS (
    SELECT m.user_id FROM public.memberships m WHERE m.table_id = p_table
    UNION
    SELECT r.user_id FROM public.requests r WHERE r.table_id = p_table AND r.status IN ('pending', 'approved')
    UNION
    SELECT w.user_id FROM public.waitlist w WHERE w.table_id = p_table
  ), ins AS (
    INSERT INTO public.notifications (user_id, icon, body)
    SELECT user_id, 'warning',
           'Tavolina "' || v_title || '" u anulua nga ekipi i ejaBashkohu. Arsyeja: ' || v_reason
    FROM recipients
    RETURNING 1
  )
  SELECT count(*) INTO v_notified FROM ins;

  UPDATE public.requests SET status = 'expired'
  WHERE table_id = p_table AND status IN ('pending', 'approved');

  DELETE FROM public.waitlist WHERE table_id = p_table;

  PERFORM public._admin_log('table_cancelled', 'table', p_table, v_title,
                            jsonb_build_object('reason', v_reason, 'notified', v_notified, 'previous_status', v_status));
  RETURN v_notified;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_table(p_table uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_title text; v_status text; v_event timestamptz;
BEGIN
  PERFORM public._admin_guard();
  SELECT title, status, event_datetime INTO v_title, v_status, v_event FROM public.tables WHERE id = p_table;
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'Tavolina nuk u gjet';
  END IF;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'Vetëm tavolinat e anuluara rikthehen';
  END IF;
  IF v_event <= now() THEN
    RAISE EXCEPTION 'Data e tavolinës ka kaluar';
  END IF;
  UPDATE public.tables SET status = 'open' WHERE id = p_table;
  PERFORM public._admin_log('table_restored', 'table', p_table, v_title, '{}'::jsonb);
END;
$$;

-- Send an in-app notification to one user (support / warnings).
CREATE OR REPLACE FUNCTION public.admin_notify_user(p_user uuid, p_message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_msg text := NULLIF(trim(COALESCE(p_message, '')), '');
BEGIN
  PERFORM public._admin_guard();
  IF v_msg IS NULL OR char_length(v_msg) > 500 THEN
    RAISE EXCEPTION 'Mesazhi duhet të ketë 1 deri 500 karaktere';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user) THEN
    RAISE EXCEPTION 'Përdoruesi nuk u gjet';
  END IF;
  INSERT INTO public.notifications (user_id, icon, body) VALUES (p_user, 'info', v_msg);
  PERFORM public._admin_log('user_notified', 'user', p_user, public._admin_user_label(p_user),
                            jsonb_build_object('message', v_msg));
END;
$$;

-- ───────────────────────── 13. Existing report actions + audit ─────────────────────────
-- Same logic as 20260815180000_admin_panel.sql, plus an audit-log row.

CREATE OR REPLACE FUNCTION public.admin_dismiss_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reported uuid;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta bëjnë këtë';
  END IF;
  UPDATE public.reports
  SET status = 'reviewed_dismissed', reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_report_id
  RETURNING reported_id INTO v_reported;
  PERFORM public._admin_log('report_dismissed', 'user', v_reported, public._admin_user_label(v_reported),
                            jsonb_build_object('report_id', p_report_id));
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_dismiss_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dismiss_report(uuid) TO authenticated;

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
  PERFORM public._admin_log('user_banned', 'user', v_reported, public._admin_user_label(v_reported),
                            jsonb_build_object('reason', p_reason, 'ban_count', v_count, 'report_id', p_report_id));
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_ban_from_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ban_from_report(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_immediately(p_report_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reported uuid; v_label text; v_email text;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta bëjnë këtë';
  END IF;
  SELECT reported_id INTO v_reported FROM public.reports WHERE id = p_report_id;

  UPDATE public.reports
  SET status = 'deleted_immediately', reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_report_id;

  v_label := public._admin_user_label(v_reported);
  SELECT email INTO v_email FROM auth.users WHERE id = v_reported;
  PERFORM public._admin_log('user_deleted', 'user', v_reported, v_label,
                            jsonb_build_object('reason', p_reason, 'email', v_email, 'report_id', p_report_id));

  PERFORM net.http_post(
    url := 'https://upxxfhvgbmddhyebaiug.supabase.co/functions/v1/delete-banned-user',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public._admin_service_key()
    ),
    body := jsonb_build_object('user_id', v_reported)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_immediately(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_immediately(uuid, text) TO authenticated;

-- admin_reactivate_account (older RPC) also writes to the audit log now.
CREATE OR REPLACE FUNCTION public.admin_reactivate_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta bëjnë këtë';
  END IF;
  UPDATE public.profiles SET deactivated_at = NULL WHERE id = p_user_id;
  PERFORM public._admin_log('user_reactivated', 'user', p_user_id, public._admin_user_label(p_user_id), '{}'::jsonb);
END;
$$;

-- ───────────────────────── 14. Grants ─────────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.admin_get_dashboard(text)',
    'public.admin_list_users(text, text, text, int, int)',
    'public.admin_get_user(uuid)',
    'public.admin_list_tables(text, text, text, text, text, int, int)',
    'public.admin_get_table(uuid)',
    'public.admin_list_payments(text, text, text, timestamptz, timestamptz, int, int)',
    'public.admin_list_reports(text)',
    'public.admin_list_bans()',
    'public.admin_list_wednesday()',
    'public.admin_set_restaurant_active(uuid, boolean)',
    'public.admin_upsert_restaurant(uuid, text, text, text, text)',
    'public.admin_global_search(text)',
    'public.admin_list_audit(int, int)',
    'public.admin_ban_user(uuid, text)',
    'public.admin_set_user_deactivated(uuid, boolean, text)',
    'public.admin_set_user_admin(uuid, boolean)',
    'public.admin_delete_user(uuid, text)',
    'public.admin_cancel_table(uuid, text)',
    'public.admin_restore_table(uuid)',
    'public.admin_notify_user(uuid, text)',
    'public.admin_reactivate_account(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
