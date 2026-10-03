-- ═══════════════════════════════════════════════════════════════════
--  Packages (Bazike / Premium) + real Wednesday Dinner matching
--
--  Bazike  (free):   one home city only (other cities are not even visible),
--                    a monthly limit of hosted tables (default 3, admin-editable).
--  Premium (paid):   all cities, no limits, first in line for Wednesday Dinner.
--                    Packages: 1 month €9.99 · 3 months €24.99 · 12 months €59.99.
--
--  Payment: no card processor is connected yet, so buying creates an order that
--  an admin marks as paid (bank transfer / cash / WhatsApp). The provider webhook
--  will later call activate_subscription() with the service role instead.
--
--  Everything is enforced in the database (triggers + a RESTRICTIVE RLS policy),
--  not only in the app.
-- ═══════════════════════════════════════════════════════════════════

-- Kosovo local time for "this month" and for Wednesday 20:00.
CREATE OR REPLACE FUNCTION public._kosovo_now()
RETURNS timestamp LANGUAGE sql STABLE AS $$ SELECT now() AT TIME ZONE 'Europe/Belgrade' $$;

-- ───────────────────────── Plans ─────────────────────────
CREATE TABLE IF NOT EXISTS public.plans (
  id                  text PRIMARY KEY,
  tier                text NOT NULL CHECK (tier IN ('basic', 'premium')),
  months              int CHECK (months IS NULL OR months BETWEEN 1 AND 36),
  price_cents         int NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  monthly_table_limit int CHECK (monthly_table_limit IS NULL OR monthly_table_limit BETWEEN 0 AND 1000),
  monthly_join_limit  int CHECK (monthly_join_limit IS NULL OR monthly_join_limit BETWEEN 0 AND 1000),
  active              boolean NOT NULL DEFAULT true,
  sort                int NOT NULL DEFAULT 0,
  CHECK ((tier = 'basic') = (months IS NULL))
);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_read ON public.plans;
CREATE POLICY plans_read ON public.plans FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.plans TO authenticated;

INSERT INTO public.plans (id, tier, months, price_cents, monthly_table_limit, monthly_join_limit, sort) VALUES
  ('basic',       'basic',   NULL, 0,    3,    NULL, 0),
  ('premium_1m',  'premium', 1,    999,  NULL, NULL, 1),
  ('premium_3m',  'premium', 3,    2499, NULL, NULL, 2),
  ('premium_12m', 'premium', 12,   5999, NULL, NULL, 3)
ON CONFLICT (id) DO NOTHING;   -- re-running never overwrites prices an admin changed

-- ───────────────────────── Subscriptions + orders ─────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id      text NOT NULL REFERENCES public.plans(id),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  source       text NOT NULL CHECK (source IN ('admin_grant', 'manual_payment', 'provider')),
  amount_cents int NOT NULL DEFAULT 0,
  provider_ref text,
  note         text,
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions (user_id, ends_at DESC);

CREATE TABLE IF NOT EXISTS public.subscription_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE DEFAULT 'EBP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id         text NOT NULL REFERENCES public.plans(id),
  amount_cents    int NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  handled_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handled_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_pending_order ON public.subscription_orders (user_id) WHERE status = 'pending';

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_own ON public.subscriptions;
CREATE POLICY subscriptions_own ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin_user());
DROP POLICY IF EXISTS subscription_orders_own ON public.subscription_orders;
CREATE POLICY subscription_orders_own ON public.subscription_orders FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin_user());
GRANT SELECT ON public.subscriptions, public.subscription_orders TO authenticated;
-- writes only through the functions below

-- Subscription income shows up in the admin Payments page too.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL;

-- ───────────────────────── Home city ─────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_city text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_city_changed_at timestamptz;

-- Existing users: home city = the city they used most (tables hosted + joined).
UPDATE public.profiles p
SET home_city = x.city
FROM (
  SELECT DISTINCT ON (uid) uid, city FROM (
    SELECT t.host_id AS uid, t.city FROM public.tables t WHERE t.kind <> 'darka_e_merkures'
    UNION ALL
    SELECT m.user_id, t.city FROM public.memberships m JOIN public.tables t ON t.id = m.table_id WHERE t.kind <> 'darka_e_merkures'
  ) u GROUP BY uid, city ORDER BY uid, count(*) DESC, city
) x
WHERE p.id = x.uid AND p.home_city IS NULL;

-- ───────────────────────── Plan helpers ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_premium(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND is_admin)
      OR EXISTS (SELECT 1 FROM public.subscriptions
                 WHERE user_id = p_user AND status = 'active' AND now() >= starts_at AND now() < ends_at)
$$;

CREATE OR REPLACE FUNCTION public._premium_until(p_user uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT max(ends_at) FROM public.subscriptions WHERE user_id = p_user AND status = 'active' AND ends_at > now()
$$;

CREATE OR REPLACE FUNCTION public._month_start()
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', now() AT TIME ZONE 'Europe/Belgrade') AT TIME ZONE 'Europe/Belgrade'
$$;

-- Used by the RESTRICTIVE policy below: may the current user see listings in this city?
CREATE OR REPLACE FUNCTION public.can_see_city(p_city text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_premium(auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND home_city = p_city)
  )
$$;

REVOKE ALL ON FUNCTION public._premium_until(uuid) FROM PUBLIC, anon, authenticated;

-- Shared: give a user `months` of premium, stacking after any active period.
CREATE OR REPLACE FUNCTION public._grant_premium(
  p_user uuid, p_plan text, p_source text, p_amount int, p_ref text, p_note text, p_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_months int; v_start timestamptz; v_id uuid;
BEGIN
  SELECT months INTO v_months FROM public.plans WHERE id = p_plan AND tier = 'premium';
  IF v_months IS NULL THEN RAISE EXCEPTION 'Pako e panjohur'; END IF;
  v_start := GREATEST(now(), COALESCE(public._premium_until(p_user), now()));
  INSERT INTO public.subscriptions (user_id, plan_id, starts_at, ends_at, source, amount_cents, provider_ref, note, created_by)
  VALUES (p_user, p_plan, v_start, v_start + make_interval(months => v_months), p_source, COALESCE(p_amount, 0), p_ref, p_note, p_by)
  RETURNING id INTO v_id;

  IF COALESCE(p_amount, 0) > 0 THEN
    INSERT INTO public.payments (user_id, table_id, subscription_id, amount_cents, provider, provider_ref, ticket_code, table_title)
    VALUES (p_user, NULL, v_id, p_amount, CASE p_source WHEN 'provider' THEN 'provider' ELSE 'manual' END,
            COALESCE(p_ref, 'SUB-' || v_id::text), NULL, 'Premium: ' || p_plan);
  END IF;

  INSERT INTO public.notifications (user_id, icon, body, kind, params)
  VALUES (p_user, 'info', 'Premium u aktivizua deri më ' || to_char((v_start + make_interval(months => v_months)) AT TIME ZONE 'Europe/Belgrade', 'DD.MM.YYYY') || '.',
          'premiumActivated', jsonb_build_object('at', v_start + make_interval(months => v_months)));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._grant_premium(uuid, text, text, int, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- ───────────────────────── Enforcement ─────────────────────────
-- Basic users: listings only in their home city, and a monthly hosting cap.
CREATE OR REPLACE FUNCTION public.enforce_plan_tables()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_home text; v_limit int; v_used int;
BEGIN
  -- system-created Wednesday tables and service-role / SQL-editor inserts are exempt
  IF NEW.kind = 'darka_e_merkures' OR auth.uid() IS NULL OR public.is_premium(NEW.host_id) THEN
    RETURN NEW;
  END IF;
  SELECT home_city INTO v_home FROM public.profiles WHERE id = NEW.host_id;
  IF v_home IS NULL THEN RAISE EXCEPTION 'Zgjidh qytetin tënd fillimisht'; END IF;
  IF NEW.city IS DISTINCT FROM v_home THEN
    RAISE EXCEPTION 'Me pakon Bazike hap tavolina vetëm në qytetin tënd';
  END IF;
  SELECT monthly_table_limit INTO v_limit FROM public.plans WHERE id = 'basic';
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM public.tables
    WHERE host_id = NEW.host_id AND kind <> 'darka_e_merkures' AND created_at >= public._month_start();
    IF v_used >= v_limit THEN
      RAISE EXCEPTION 'Ke arritur limitin mujor të tavolinave për pakon Bazike';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_plan_tables ON public.tables;
CREATE TRIGGER trg_enforce_plan_tables BEFORE INSERT ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_tables();

CREATE OR REPLACE FUNCTION public.enforce_plan_join()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_city text; v_kind text; v_home text; v_limit int; v_used int;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() OR public.is_premium(NEW.user_id) THEN
    RETURN NEW;  -- e.g. the waitlist trigger promoting someone, or service role
  END IF;
  SELECT city, kind INTO v_city, v_kind FROM public.tables WHERE id = NEW.table_id;
  IF v_kind = 'darka_e_merkures' THEN RETURN NEW; END IF;
  SELECT home_city INTO v_home FROM public.profiles WHERE id = NEW.user_id;
  IF v_home IS NULL OR v_city IS DISTINCT FROM v_home THEN
    RAISE EXCEPTION 'Me pakon Bazike bashkohesh vetëm në qytetin tënd';
  END IF;
  IF TG_TABLE_NAME = 'requests' THEN
    SELECT monthly_join_limit INTO v_limit FROM public.plans WHERE id = 'basic';
    IF v_limit IS NOT NULL THEN
      SELECT count(*) INTO v_used FROM public.requests WHERE user_id = NEW.user_id AND created_at >= public._month_start();
      IF v_used >= v_limit THEN RAISE EXCEPTION 'Ke arritur limitin mujor të bashkimeve për pakon Bazike'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_plan_requests ON public.requests;
CREATE TRIGGER trg_enforce_plan_requests BEFORE INSERT ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_join();
DROP TRIGGER IF EXISTS trg_enforce_plan_waitlist ON public.waitlist;
CREATE TRIGGER trg_enforce_plan_waitlist BEFORE INSERT ON public.waitlist
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_join();

-- "Bazike doesn't even see other cities": a RESTRICTIVE policy is ANDed with the
-- existing tables_select / tables_select_own policies, so they stay untouched.
-- Your own tables, tables you're part of, and admins are always visible.
-- Definer helper: reading memberships/requests inside a tables policy would
-- re-enter the requests policy (which reads tables) → infinite recursion.
CREATE OR REPLACE FUNCTION public._is_table_participant(p_table uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships WHERE table_id = p_table AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.requests WHERE table_id = p_table AND user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public._is_table_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_table_participant(uuid) TO authenticated;

DROP POLICY IF EXISTS tables_plan_city ON public.tables;
CREATE POLICY tables_plan_city ON public.tables AS RESTRICTIVE FOR SELECT TO authenticated USING (
  host_id = auth.uid()
  OR public.can_see_city(city)
  OR public.is_admin_user()
  OR public._is_table_participant(tables.id)
);

-- ───────────────────────── User RPCs ─────────────────────────
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); p record; b record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Duhet të jesh i kyçur'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id = v_uid;
  SELECT * INTO b FROM public.plans WHERE id = 'basic';
  RETURN jsonb_build_object(
    'tier', CASE WHEN public.is_premium(v_uid) THEN 'premium' ELSE 'basic' END,
    'premium_until', public._premium_until(v_uid),
    'is_admin', p.is_admin,
    'home_city', p.home_city,
    'home_city_changed_at', p.home_city_changed_at,
    'can_change_city_at', CASE WHEN p.home_city_changed_at IS NULL THEN NULL ELSE p.home_city_changed_at + interval '30 days' END,
    'table_limit', b.monthly_table_limit,
    'join_limit', b.monthly_join_limit,
    'tables_this_month', (SELECT count(*) FROM public.tables WHERE host_id = v_uid AND kind <> 'darka_e_merkures' AND created_at >= public._month_start()),
    'joins_this_month', (SELECT count(*) FROM public.requests WHERE user_id = v_uid AND created_at >= public._month_start()),
    'pending_order', (SELECT to_jsonb(o) FROM (SELECT id, code, plan_id, amount_cents, created_at FROM public.subscription_orders
                       WHERE user_id = v_uid AND status = 'pending') o),
    'plans', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort) FROM (SELECT id, tier, months, price_cents, monthly_table_limit, sort FROM public.plans WHERE active) x)
  );
END;
$$;

-- Basic users may move their home city once every 30 days (the first choice is free).
CREATE OR REPLACE FUNCTION public.set_home_city(p_city text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p record; v_city text := NULLIF(trim(COALESCE(p_city, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Duhet të jesh i kyçur'; END IF;
  IF v_city IS NULL OR char_length(v_city) > 60 THEN RAISE EXCEPTION 'Qytet i pavlefshëm'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id = auth.uid();
  IF p.home_city = v_city THEN RETURN; END IF;
  IF p.home_city IS NOT NULL AND NOT public.is_premium(auth.uid())
     AND p.home_city_changed_at IS NOT NULL AND p.home_city_changed_at > now() - interval '30 days' THEN
    RAISE EXCEPTION 'Qytetin mund ta ndryshosh një herë në 30 ditë';
  END IF;
  UPDATE public.profiles
  SET home_city = v_city,
      home_city_changed_at = CASE WHEN p.home_city IS NULL THEN NULL ELSE now() END
  WHERE id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.request_premium(p_plan text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_price int; v_order record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Duhet të jesh i kyçur'; END IF;
  SELECT price_cents INTO v_price FROM public.plans WHERE id = p_plan AND tier = 'premium' AND active;
  IF v_price IS NULL THEN RAISE EXCEPTION 'Pako e panjohur'; END IF;
  UPDATE public.subscription_orders SET status = 'cancelled' WHERE user_id = auth.uid() AND status = 'pending';
  INSERT INTO public.subscription_orders (user_id, plan_id, amount_cents) VALUES (auth.uid(), p_plan, v_price)
  RETURNING * INTO v_order;
  RETURN jsonb_build_object('id', v_order.id, 'code', v_order.code, 'plan_id', p_plan, 'amount_cents', v_price);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_premium_order()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.subscription_orders SET status = 'cancelled' WHERE user_id = auth.uid() AND status = 'pending'
$$;

-- For the payment provider webhook (service role only).
CREATE OR REPLACE FUNCTION public.activate_subscription(p_user uuid, p_plan text, p_amount_cents int, p_provider_ref text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE provider_ref = p_provider_ref AND source = 'provider') THEN
    RETURN (SELECT id FROM public.subscriptions WHERE provider_ref = p_provider_ref AND source = 'provider' LIMIT 1); -- idempotent
  END IF;
  UPDATE public.subscription_orders SET status = 'paid', handled_at = now() WHERE user_id = p_user AND status = 'pending' AND plan_id = p_plan;
  RETURN public._grant_premium(p_user, p_plan, 'provider', p_amount_cents, p_provider_ref, NULL, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.activate_subscription(uuid, text, int, text) FROM PUBLIC, anon, authenticated;

-- ───────────────────────── Admin RPCs ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_plans_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_guard();
  RETURN jsonb_build_object(
    'plans', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sort) FROM public.plans p),
    'active_premium', (SELECT count(DISTINCT user_id) FROM public.subscriptions WHERE status = 'active' AND now() >= starts_at AND now() < ends_at),
    'revenue_30d_cents', (SELECT COALESCE(sum(amount_cents), 0) FROM public.subscriptions WHERE status = 'active' AND created_at >= now() - interval '30 days'),
    'revenue_total_cents', (SELECT COALESCE(sum(amount_cents), 0) FROM public.subscriptions WHERE status = 'active'),
    'expiring_7d', (SELECT count(DISTINCT user_id) FROM public.subscriptions s WHERE status = 'active' AND ends_at BETWEEN now() AND now() + interval '7 days'
                    AND NOT EXISTS (SELECT 1 FROM public.subscriptions s2 WHERE s2.user_id = s.user_id AND s2.status = 'active' AND s2.ends_at > now() + interval '7 days')),
    'orders', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
      SELECT o.id, o.code, o.plan_id, o.amount_cents, o.status, o.created_at, o.handled_at, o.user_id,
             trim(p.first_name || ' ' || p.last_name) AS name, p.photo_path, u.email
      FROM public.subscription_orders o JOIN public.profiles p ON p.id = o.user_id LEFT JOIN auth.users u ON u.id = o.user_id
      ORDER BY (o.status = 'pending') DESC, o.created_at DESC LIMIT 200) x), '[]'::jsonb),
    'subscriptions', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
      SELECT s.id, s.plan_id, s.starts_at, s.ends_at, s.status, s.source, s.amount_cents, s.note, s.created_at, s.user_id,
             trim(p.first_name || ' ' || p.last_name) AS name, p.photo_path,
             (s.status = 'active' AND now() >= s.starts_at AND now() < s.ends_at) AS current
      FROM public.subscriptions s JOIN public.profiles p ON p.id = s.user_id
      ORDER BY s.created_at DESC LIMIT 300) x), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_order_paid(p_order uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE o record; v_sub uuid;
BEGIN
  PERFORM public._admin_guard();
  SELECT * INTO o FROM public.subscription_orders WHERE id = p_order FOR UPDATE;
  IF o IS NULL OR o.status <> 'pending' THEN RAISE EXCEPTION 'Porosia nuk është në pritje'; END IF;
  v_sub := public._grant_premium(o.user_id, o.plan_id, 'manual_payment', o.amount_cents, o.code, NULL, auth.uid());
  UPDATE public.subscription_orders SET status = 'paid', subscription_id = v_sub, handled_by = auth.uid(), handled_at = now() WHERE id = p_order;
  PERFORM public._admin_log('premium_order_paid', 'user', o.user_id, public._admin_user_label(o.user_id),
                            jsonb_build_object('plan', o.plan_id, 'amount_cents', o.amount_cents, 'code', o.code));
  RETURN v_sub;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_order(p_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_guard();
  UPDATE public.subscription_orders SET status = 'cancelled', handled_by = auth.uid(), handled_at = now()
  WHERE id = p_order AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Porosia nuk është në pritje'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_premium(p_user uuid, p_plan text, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_sub uuid;
BEGIN
  PERFORM public._admin_guard();
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user) THEN RAISE EXCEPTION 'Përdoruesi nuk u gjet'; END IF;
  v_sub := public._grant_premium(p_user, p_plan, 'admin_grant', 0, NULL, NULLIF(trim(COALESCE(p_note, '')), ''), auth.uid());
  PERFORM public._admin_log('premium_granted', 'user', p_user, public._admin_user_label(p_user),
                            jsonb_build_object('plan', p_plan, 'reason', NULLIF(trim(COALESCE(p_note, '')), '')));
  RETURN v_sub;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_premium(p_user uuid, p_reason text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  PERFORM public._admin_guard();
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Shkruaj arsyen'; END IF;
  UPDATE public.subscriptions SET status = 'revoked' WHERE user_id = p_user AND status = 'active' AND ends_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public._admin_log('premium_revoked', 'user', p_user, public._admin_user_label(p_user), jsonb_build_object('reason', p_reason));
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_plan(p_plan text, p_price_cents int, p_table_limit int, p_join_limit int, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE old record;
BEGIN
  PERFORM public._admin_guard();
  SELECT * INTO old FROM public.plans WHERE id = p_plan;
  IF old IS NULL THEN RAISE EXCEPTION 'Pako e panjohur'; END IF;
  UPDATE public.plans SET
    price_cents = CASE WHEN tier = 'premium' THEN GREATEST(0, COALESCE(p_price_cents, price_cents)) ELSE 0 END,
    monthly_table_limit = CASE WHEN tier = 'basic' THEN p_table_limit ELSE NULL END,
    monthly_join_limit = CASE WHEN tier = 'basic' THEN p_join_limit ELSE NULL END,
    active = CASE WHEN tier = 'basic' THEN true ELSE COALESCE(p_active, active) END
  WHERE id = p_plan;
  PERFORM public._admin_log('plan_updated', 'plan', NULL, p_plan,
    jsonb_build_object('price_cents', p_price_cents, 'table_limit', p_table_limit, 'join_limit', p_join_limit, 'active', p_active,
                       'before', jsonb_build_object('price_cents', old.price_cents, 'table_limit', old.monthly_table_limit)));
END;
$$;

-- ───────────────────────── Wednesday Dinner: real matching ─────────────────────────
-- Sign up until Tuesday 20:00 (24 h before). Groups of up to 6 are then formed
-- per city, Premium members placed first, then by sign-up time. People who
-- don't fit (not enough restaurants, or fewer than 3 left over) go on a waitlist.
ALTER TABLE public.wednesday_groups ADD COLUMN IF NOT EXISTS table_id uuid REFERENCES public.tables(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.wednesday_signups (
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dinner_date timestamptz NOT NULL,
  city        text NOT NULL,
  langs       text[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'signed_up' CHECK (status IN ('signed_up', 'grouped', 'waitlisted', 'cancelled')),
  premium     boolean NOT NULL DEFAULT false,   -- snapshot at formation time (for audit)
  group_id    uuid REFERENCES public.wednesday_groups(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dinner_date)
);
CREATE INDEX IF NOT EXISTS idx_wed_signups_open ON public.wednesday_signups (dinner_date, city) WHERE status = 'signed_up';
ALTER TABLE public.wednesday_signups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wed_signups_own ON public.wednesday_signups;
CREATE POLICY wed_signups_own ON public.wednesday_signups FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin_user());
GRANT SELECT ON public.wednesday_signups TO authenticated;

-- Next Wednesday 20:00 Kosovo time whose sign-up deadline (Tue 20:00) is still ahead.
CREATE OR REPLACE FUNCTION public._next_wednesday_dinner()
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v_local timestamp := now() AT TIME ZONE 'Europe/Belgrade'; v_dinner timestamp;
BEGIN
  v_dinner := date_trunc('day', v_local) + ((3 - extract(isodow FROM v_local)::int + 7) % 7) * interval '1 day' + interval '20 hours';
  IF v_dinner - interval '24 hours' <= v_local THEN v_dinner := v_dinner + interval '7 days'; END IF;
  RETURN v_dinner AT TIME ZONE 'Europe/Belgrade';
END;
$$;

CREATE OR REPLACE FUNCTION public.signup_wednesday(p_city text, p_langs text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_dinner timestamptz := public._next_wednesday_dinner(); v_home text;
BEGIN
  PERFORM public._require_onboarded_me();
  IF NOT EXISTS (SELECT 1 FROM public.wednesday_restaurants WHERE city = p_city AND active) THEN
    RAISE EXCEPTION 'Nuk ka restorante për këtë qytet';
  END IF;
  IF NOT public.is_premium(auth.uid()) THEN
    SELECT home_city INTO v_home FROM public.profiles WHERE id = auth.uid();
    IF v_home IS DISTINCT FROM p_city THEN RAISE EXCEPTION 'Me pakon Bazike bashkohesh vetëm në qytetin tënd'; END IF;
  END IF;
  INSERT INTO public.wednesday_signups (user_id, dinner_date, city, langs)
  VALUES (auth.uid(), v_dinner, p_city, COALESCE(p_langs, '{}'))
  ON CONFLICT (user_id, dinner_date) DO UPDATE
    SET city = EXCLUDED.city, langs = EXCLUDED.langs, status = 'signed_up', created_at = CASE
      WHEN public.wednesday_signups.status = 'cancelled' THEN now() ELSE public.wednesday_signups.created_at END
    WHERE public.wednesday_signups.status IN ('signed_up', 'cancelled');
  RETURN public.my_wednesday();
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_wednesday_signup()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.wednesday_signups SET status = 'cancelled'
  WHERE user_id = auth.uid() AND status = 'signed_up' AND dinner_date > now()
$$;

CREATE OR REPLACE FUNCTION public.my_wednesday()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s record; v_next timestamptz := public._next_wednesday_dinner();
BEGIN
  SELECT * INTO s FROM public.wednesday_signups
  WHERE user_id = auth.uid() AND dinner_date > now() - interval '3 hours' AND status <> 'cancelled'
  ORDER BY dinner_date LIMIT 1;
  RETURN jsonb_build_object(
    'next_dinner', v_next,
    'deadline', v_next - interval '24 hours',
    'premium', public.is_premium(auth.uid()),
    'signup', CASE WHEN s IS NULL THEN NULL ELSE jsonb_build_object(
      'dinner_date', s.dinner_date, 'deadline', s.dinner_date - interval '24 hours', 'city', s.city, 'status', s.status,
      'group_id', s.group_id,
      'table_id', (SELECT table_id FROM public.wednesday_groups WHERE id = s.group_id),
      'members', CASE WHEN s.group_id IS NULL THEN '[]'::jsonb ELSE (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', p.id, 'first_name', p.first_name, 'age', p.age, 'photo_path', p.photo_path)), '[]'::jsonb)
        FROM public.wednesday_participants wp JOIN public.profiles p ON p.id = wp.user_id WHERE wp.group_id = s.group_id) END
    ) END
  );
END;
$$;

-- Forms the groups for one dinner. Safe to run repeatedly: only 'signed_up' rows are used.
CREATE OR REPLACE FUNCTION public._form_wednesday_groups(p_dinner timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record; r record; v_members uuid[]; v_restaurants uuid[]; v_group uuid; v_table uuid; v_size int;
  v_groups int := 0; v_grouped int := 0; v_waitlisted int := 0; i int; v_cap int; v_n int;
BEGIN
  FOR c IN SELECT DISTINCT city FROM public.wednesday_signups WHERE dinner_date = p_dinner AND status = 'signed_up' LOOP
    -- Premium first, then people left on last week's waitlist (as promised in
    -- their notification), then first come first served.
    SELECT array_agg(s.user_id ORDER BY public.is_premium(s.user_id) DESC,
                     EXISTS (SELECT 1 FROM public.wednesday_signups w WHERE w.user_id = s.user_id AND w.status = 'waitlisted'
                             AND w.dinner_date < p_dinner AND w.dinner_date >= p_dinner - interval '15 days') DESC,
                     s.created_at) INTO v_members
    FROM public.wednesday_signups s WHERE s.dinner_date = p_dinner AND s.city = c.city AND s.status = 'signed_up';
    UPDATE public.wednesday_signups SET premium = public.is_premium(user_id)
    WHERE dinner_date = p_dinner AND city = c.city AND status = 'signed_up';

    -- one restaurant per group, never reusing a restaurant already used that evening
    SELECT array_agg(id ORDER BY random()) INTO v_restaurants FROM public.wednesday_restaurants r2
    WHERE r2.city = c.city AND r2.active
      AND NOT EXISTS (SELECT 1 FROM public.wednesday_groups g WHERE g.restaurant_id = r2.id AND g.dinner_date = p_dinner);
    v_n := COALESCE(array_length(v_members, 1), 0);
    v_cap := LEAST(COALESCE(array_length(v_restaurants, 1), 0), ceil(v_n / 6.0)::int);

    i := 1;
    FOR g IN 1 .. v_cap LOOP
      v_size := LEAST(6, v_n - i + 1);
      EXIT WHEN v_size < 3;   -- a table of 1-2 strangers isn't a dinner: they wait
      INSERT INTO public.wednesday_groups (city, dinner_date, restaurant_id) VALUES (c.city, p_dinner, v_restaurants[g])
      RETURNING id INTO v_group;
      INSERT INTO public.tables (host_id, kind, category, title, area, city, time_label, event_datetime, starts_at, spots,
                                 mystery, revealed, langs, tags, description)
      VALUES (v_members[i], 'darka_e_merkures', 'ushqim', 'Darka e së Mërkurës', 'Vendi zbulohet 24 orë para', c.city,
              to_char(p_dinner AT TIME ZONE 'Europe/Belgrade', 'DD.MM HH24:MI'), p_dinner, p_dinner, v_size,
              true, false, ARRAY['sq'], ARRAY['wednesday'], 'Darkë me të panjohur të përzgjedhur sipas kuizit.')
      RETURNING id INTO v_table;
      UPDATE public.wednesday_groups SET table_id = v_table WHERE id = v_group;
      FOR k IN i .. i + v_size - 1 LOOP
        INSERT INTO public.wednesday_participants (group_id, user_id) VALUES (v_group, v_members[k]) ON CONFLICT DO NOTHING;
        INSERT INTO public.memberships (table_id, user_id, role) VALUES (v_table, v_members[k], CASE WHEN k = i THEN 'host' ELSE 'member' END)
        ON CONFLICT DO NOTHING;
        UPDATE public.wednesday_signups SET status = 'grouped', group_id = v_group WHERE user_id = v_members[k] AND dinner_date = p_dinner;
        INSERT INTO public.notifications (user_id, icon, body, kind, params)
        VALUES (v_members[k], 'info', 'U përputhe me ' || (v_size - 1) || ' persona për Darkën e së Mërkurës! Restoranti zbulohet 24 orë para.',
                'wednesdayGrouped', jsonb_build_object('count', v_size - 1, 'at', p_dinner));
      END LOOP;
      v_groups := v_groups + 1; v_grouped := v_grouped + v_size; i := i + v_size;
    END LOOP;

    FOR r IN SELECT user_id FROM public.wednesday_signups WHERE dinner_date = p_dinner AND city = c.city AND status = 'signed_up' LOOP
      UPDATE public.wednesday_signups SET status = 'waitlisted' WHERE user_id = r.user_id AND dinner_date = p_dinner;
      INSERT INTO public.notifications (user_id, icon, body, kind, params)
      VALUES (r.user_id, 'info', 'Këtë të mërkurë nuk u formua grup për ty. Je në listën e pritjes dhe ke përparësi javën tjetër.',
              'wednesdayWaitlisted', jsonb_build_object('at', p_dinner));
      v_waitlisted := v_waitlisted + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('groups', v_groups, 'grouped', v_grouped, 'waitlisted', v_waitlisted);
END;
$$;
REVOKE ALL ON FUNCTION public._form_wednesday_groups(timestamptz) FROM PUBLIC, anon, authenticated;

-- Forms every dinner whose sign-up deadline has passed (cron or admin button).
CREATE OR REPLACE FUNCTION public.form_due_wednesday_groups()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d record; res jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN PERFORM public._admin_guard(); END IF;
  FOR d IN SELECT DISTINCT dinner_date FROM public.wednesday_signups
           WHERE status = 'signed_up' AND dinner_date - interval '24 hours' <= now() AND dinner_date > now() LOOP
    res := res || jsonb_build_object('dinner_date', d.dinner_date) || public._form_wednesday_groups(d.dinner_date);
  END LOOP;
  IF auth.uid() IS NOT NULL THEN
    PERFORM public._admin_log('wednesday_formed', 'wednesday', NULL, NULL, jsonb_build_object('result', res));
  END IF;
  RETURN res;
END;
$$;
REVOKE ALL ON FUNCTION public.form_due_wednesday_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.form_due_wednesday_groups() TO authenticated;

-- Admin can also form a specific upcoming dinner early ("Formo tani").
CREATE OR REPLACE FUNCTION public.admin_form_wednesday(p_dinner timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v jsonb; v_dinner timestamptz;
BEGIN
  PERFORM public._admin_guard();
  v_dinner := COALESCE(p_dinner, (SELECT min(dinner_date) FROM public.wednesday_signups WHERE status = 'signed_up' AND dinner_date > now()));
  IF v_dinner IS NULL THEN RETURN jsonb_build_object('groups', 0, 'grouped', 0, 'waitlisted', 0); END IF;
  v := public._form_wednesday_groups(v_dinner);
  PERFORM public._admin_log('wednesday_formed', 'wednesday', NULL, to_char(v_dinner AT TIME ZONE 'Europe/Belgrade', 'DD.MM.YYYY'), v);
  RETURN v || jsonb_build_object('dinner_date', v_dinner);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_wednesday_signups()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_guard();
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.dinner_date, x.city, x.is_premium DESC, x.created_at) FROM (
    SELECT s.user_id, s.dinner_date, s.city, s.status, s.created_at, s.group_id,
           CASE WHEN s.status = 'signed_up' THEN public.is_premium(s.user_id) ELSE s.premium END AS is_premium,
           p.first_name, p.last_name, p.photo_path, p.age
    FROM public.wednesday_signups s JOIN public.profiles p ON p.id = s.user_id
    WHERE s.dinner_date > now() - interval '1 day' AND s.status <> 'cancelled') x), '[]'::jsonb);
END;
$$;

-- Hourly automatic formation when pg_cron is available (Supabase: Database → Extensions → pg_cron).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'form-wednesday-groups';
    PERFORM cron.schedule('form-wednesday-groups', '5 * * * *', 'SELECT public.form_due_wednesday_groups()');
  END IF;
END $$;

-- ───────────────────────── Grants ─────────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.is_premium(uuid)', 'public.can_see_city(text)', 'public.my_plan()', 'public.set_home_city(text)',
    'public.request_premium(text)', 'public.cancel_premium_order()',
    'public.admin_plans_overview()', 'public.admin_mark_order_paid(uuid)', 'public.admin_cancel_order(uuid)',
    'public.admin_grant_premium(uuid, text, text)', 'public.admin_revoke_premium(uuid, text)',
    'public.admin_update_plan(text, int, int, int, boolean)',
    'public.signup_wednesday(text, text[])', 'public.cancel_wednesday_signup()', 'public.my_wednesday()',
    'public.admin_form_wednesday(timestamptz)', 'public.admin_wednesday_signups()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
