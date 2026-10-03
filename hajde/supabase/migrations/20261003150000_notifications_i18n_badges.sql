-- ═══════════════════════════════════════════════════════════════════
--  Notifications: (1) badges awarded once per user, ever; (2) every
--  notification renders in the VIEWER's language.
--
--  Before: badges lived only in React state, so every reload "forgot" them and
--  the next table created awarded "Nikoqiri i ri" again (one row per session).
--  Notifications were stored as finished text in whatever language was active
--  when written (DB triggers always Albanian; host notices in the guest's
--  language), so a user saw a mix of languages.
--
--  After: rows carry kind + params; the app translates at display time.
--  `body` stays as an Albanian/fallback text for old clients and emails.
--  No existing function is redefined: server-written rows are tagged by a
--  BEFORE INSERT trigger that recognises their (fixed) Albanian templates.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ───────── text → kind rules (server templates + every client string in sq/en/de/mk) ─────────
CREATE TABLE IF NOT EXISTS public.notification_text_rules (
  id          serial PRIMARY KEY,
  kind        text NOT NULL,
  lang        text NOT NULL,
  pattern     text NOT NULL,
  param_names text[] NOT NULL DEFAULT '{}',
  priority    int NOT NULL DEFAULT 50,
  UNIQUE (kind, lang, pattern)
);
CREATE TABLE IF NOT EXISTS public.notification_badge_labels (
  label     text PRIMARY KEY,
  badge_key text NOT NULL
);
ALTER TABLE public.notification_text_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_badge_labels ENABLE ROW LEVEL SECURITY;
-- no policies: internal lookup tables, read only by the definer functions below

-- Server-side Albanian templates (schema.sql triggers, ban_user, confirm_paid_seat, admin_cancel_table).
-- Tolerant of "—" vs "." because the em-dash cleanup changed some messages.
INSERT INTO public.notification_text_rules (kind, lang, pattern, param_names, priority) VALUES
  ('requestNew',            'sq', '^(.*) kërkon t''i bashkohet "(.*)"\.', ARRAY['name', 'title'], 10),
  ('requestApprovedGuest',  'sq', '^U aprovove për "(.*)"\.', ARRAY['title'], 10),
  ('waitlistSpot',          'sq', '^U lirua një vend te "(.*)"', ARRAY['title'], 10),
  ('mutualMatch',           'sq', '^Përputhje e ndërsjellë!', ARRAY[]::text[], 10),
  ('accountSuspended',      'sq', '^Llogaria juaj u pezullua\. Arsyeja: (.*)\. Pezullim (\d+)/3\.?$', ARRAY['reason', 'count'], 10),
  ('tableCancelledByAdmin', 'sq', '^Tavolina "(.*)" u anulua nga ekipi i ejaBashkohu\. Arsyeja: (.*)$', ARRAY['title', 'reason'], 10)
ON CONFLICT DO NOTHING;

-- Client strings, generated from src/i18n/locales/*.js (all four languages).
INSERT INTO public.notification_text_rules (kind, lang, pattern, param_names, priority)
SELECT kind, lang, pattern, param_names, 50 FROM (VALUES
  ('badgeEarned', 'sq', '^Fitove distinktivin "(.*?)"! Shikoje te Tavolinat e mia\.$', ARRAY['label']::text[]),
  ('tasteProfileSaved', 'sq', '^Profili i shijeve u ruajt\. Tavolinat renditen sipas teje\.$', ARRAY[]::text[]),
  ('tasteProfileLocalFailed', 'sq', '^Profili i shijeve u krijua lokalisht\. Ruajtja në server dështoi\. Provo sërish më vonë\.$', ARRAY[]::text[]),
  ('seatConfirmedRide', 'sq', '^Ulësja u konfirmua! Shihemi te nisja: (.*?), (.*?)\.$', ARRAY['area', 'time']::text[]),
  ('seatConfirmedTicket', 'sq', '^Vendi u konfirmua! Bileta jote: (.*?)$', ARRAY['code']::text[]),
  ('reportSubmitted', 'sq', '^Raporti u dërgua\. Ekipi ynë e shqyrton brenda 24 orësh\.$', ARRAY[]::text[]),
  ('requestApproved', 'sq', '^Kërkesa u aprovua\. Personi duhet të konfirmojë vendin\.$', ARRAY[]::text[]),
  ('wednesdayMatch', 'sq', '^U përputhe me 5 persona për Darkën e së Mërkurës! Konfirmo vendin\. Restoranti zbulohet 24h para\.$', ARRAY[]::text[]),
  ('hostSeatConfirmedNotif', 'sq', '^(.*?) konfirmoi vendin te "(.*?)"\.$', ARRAY['guest', 'table']::text[]),
  ('tableClosedByHostNotif', 'sq', '^Tavolina "(.*?)" u mbyll nga nikoqiri\.$', ARRAY['table']::text[]),
  ('badgeEarned', 'en', '^You earned the "(.*?)" badge! See it under My tables\.$', ARRAY['label']::text[]),
  ('tasteProfileSaved', 'en', '^Taste profile saved\. Tables are ranked for you\.$', ARRAY[]::text[]),
  ('tasteProfileLocalFailed', 'en', '^Taste profile saved locally\. Server sync failed\. Try again later\.$', ARRAY[]::text[]),
  ('seatConfirmedRide', 'en', '^Seat confirmed! See you at departure: (.*?), (.*?)\.$', ARRAY['area', 'time']::text[]),
  ('seatConfirmedTicket', 'en', '^Seat confirmed! Your ticket: (.*?)$', ARRAY['code']::text[]),
  ('reportSubmitted', 'en', '^Report submitted\. Our team reviews it within 24 hours\.$', ARRAY[]::text[]),
  ('requestApproved', 'en', '^Request approved\. The person must confirm their seat\.$', ARRAY[]::text[]),
  ('wednesdayMatch', 'en', '^Matched with 5 people for Wednesday Dinner! Confirm your seat\. Restaurant revealed 24h before\.$', ARRAY[]::text[]),
  ('hostSeatConfirmedNotif', 'en', '^(.*?) confirmed their seat at "(.*?)"\.$', ARRAY['guest', 'table']::text[]),
  ('tableClosedByHostNotif', 'en', '^Table "(.*?)" was closed by the host\.$', ARRAY['table']::text[]),
  ('badgeEarned', 'de', '^Abzeichen "(.*?)" erhalten! Sieh es unter Meine Tische\.$', ARRAY['label']::text[]),
  ('tasteProfileSaved', 'de', '^Geschmacksprofil gespeichert\. Tische werden für dich sortiert\.$', ARRAY[]::text[]),
  ('tasteProfileLocalFailed', 'de', '^Geschmacksprofil lokal gespeichert\. Server-Sync fehlgeschlagen\. Später erneut versuchen\.$', ARRAY[]::text[]),
  ('seatConfirmedRide', 'de', '^Platz bestätigt! Treffpunkt: (.*?), (.*?)\.$', ARRAY['area', 'time']::text[]),
  ('seatConfirmedTicket', 'de', '^Platz bestätigt! Dein Ticket: (.*?)$', ARRAY['code']::text[]),
  ('reportSubmitted', 'de', '^Meldung gesendet\. Unser Team prüft innerhalb von 24 Stunden\.$', ARRAY[]::text[]),
  ('requestApproved', 'de', '^Anfrage genehmigt\. Die Person muss den Platz bestätigen\.$', ARRAY[]::text[]),
  ('wednesdayMatch', 'de', '^Mit 5 Personen für Mittwochs-Dinner gematcht! Platz bestätigen\. Restaurant 24h vorher enthüllt\.$', ARRAY[]::text[]),
  ('hostSeatConfirmedNotif', 'de', '^(.*?) hat den Platz bei „(.*?)“ bestätigt\.$', ARRAY['guest', 'table']::text[]),
  ('tableClosedByHostNotif', 'de', '^Tisch „(.*?)“ wurde vom Gastgeber geschlossen\.$', ARRAY['table']::text[]),
  ('badgeEarned', 'mk', '^Ја добив значката "(.*?)"! Види ја кај Мои маси\.$', ARRAY['label']::text[]),
  ('tasteProfileSaved', 'mk', '^Профилот на вкус е зачуван\. Масите се сортирани за тебе\.$', ARRAY[]::text[]),
  ('tasteProfileLocalFailed', 'mk', '^Профилот е локално зачуван\. Синхронизацијата не успеа\. Обиди се подоцна\.$', ARRAY[]::text[]),
  ('seatConfirmedRide', 'mk', '^Местото е потврдено! Се гледаме на тргување: (.*?), (.*?)\.$', ARRAY['area', 'time']::text[]),
  ('seatConfirmedTicket', 'mk', '^Местото е потврдено! Твојот билет: (.*?)$', ARRAY['code']::text[]),
  ('reportSubmitted', 'mk', '^Пријавата е испратена\. Нашиот тим ја прегледува во 24 часа\.$', ARRAY[]::text[]),
  ('requestApproved', 'mk', '^Барањето е одобрено\. Лицето мора да го потврди местото\.$', ARRAY[]::text[]),
  ('wednesdayMatch', 'mk', '^Се совпадна со 5 луѓе за Среда вечера! Потврди место\. Ресторанот се открива 24ч пред\.$', ARRAY[]::text[]),
  ('hostSeatConfirmedNotif', 'mk', '^(.*?) го потврди местото на „(.*?)“\.$', ARRAY['guest', 'table']::text[]),
  ('tableClosedByHostNotif', 'mk', '^Мasata „(.*?)“ ја затвори домаќинот\.$', ARRAY['table']::text[])
) v(kind, lang, pattern, param_names)
ON CONFLICT DO NOTHING;

-- Older Macedonian text had Latin letters mixed in ("Мasata"); keep matching it.
INSERT INTO public.notification_text_rules (kind, lang, pattern, param_names, priority) VALUES
  ('tableClosedByHostNotif', 'mk', '^Масата „(.*?)“ ја затвори домаќинот\.$', ARRAY['table'], 50),
  ('badgeEarned', 'mk', '^Ја доби значката "(.*?)"! Види ја кај Мои маси\.$', ARRAY['label'], 50)
ON CONFLICT DO NOTHING;

-- Badge labels in every language → stable badge key (so old "badge earned" rows re-translate).
INSERT INTO public.notification_badge_labels (label, badge_key) VALUES
  ('Profil i plotë', 'profileComplete'),
  ('Tavolina e parë', 'firstJoin'),
  ('Vlerësuesi', 'firstRate'),
  ('Nikoqiri i ri', 'firstHost'),
  ('Complete profile', 'profileComplete'),
  ('First table', 'firstJoin'),
  ('First rating', 'firstRate'),
  ('New host', 'firstHost'),
  ('Profil vollständig', 'profileComplete'),
  ('Erster Tisch', 'firstJoin'),
  ('Erste Bewertung', 'firstRate'),
  ('Neuer Gastgeber', 'firstHost'),
  ('Комpletен профил', 'profileComplete'),
  ('Прва маса', 'firstJoin'),
  ('Прва оценка', 'firstRate'),
  ('Нов домаќин', 'firstHost'),
  ('Комплетен профил', 'profileComplete')
ON CONFLICT DO NOTHING;

-- ───────── classifier ─────────
CREATE OR REPLACE FUNCTION public.notification_classify(p_body text, OUT o_kind text, OUT o_params jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; m text[]; i int;
BEGIN
  o_params := '{}'::jsonb;
  IF p_body IS NULL THEN RETURN; END IF;
  FOR r IN SELECT * FROM public.notification_text_rules ORDER BY priority, id LOOP
    m := regexp_match(p_body, r.pattern);
    IF m IS NOT NULL THEN
      o_kind := r.kind;
      FOR i IN 1 .. COALESCE(array_length(r.param_names, 1), 0) LOOP
        o_params := o_params || jsonb_build_object(r.param_names[i], m[i]);
      END LOOP;
      IF r.kind = 'badgeEarned' AND o_params ? 'label' THEN
        o_params := o_params || COALESCE(
          (SELECT jsonb_build_object('badge', badge_key) FROM public.notification_badge_labels WHERE label = o_params->>'label'),
          '{}'::jsonb);
      END IF;
      RETURN;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.notification_classify(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notifications_tag_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c record;
BEGIN
  IF NEW.kind IS NULL THEN
    SELECT * INTO c FROM public.notification_classify(NEW.body);
    IF c.o_kind IS NOT NULL THEN
      NEW.kind := c.o_kind;
      NEW.params := COALESCE(NEW.params, '{}'::jsonb) || c.o_params;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_tag_kind ON public.notifications;
CREATE TRIGGER trg_notifications_tag_kind
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_tag_kind();

-- Backfill existing rows.
UPDATE public.notifications n
SET kind = x.o_kind, params = n.params || x.o_params
FROM (
  SELECT t.id, c.o_kind, c.o_params
  FROM public.notifications t, LATERAL public.notification_classify(t.body) c
  WHERE t.kind IS NULL
) x
WHERE n.id = x.id AND x.o_kind IS NOT NULL;

-- ───────── badges: once per user, atomically ─────────
CREATE OR REPLACE FUNCTION public.award_badge(p_badge text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := CASE p_badge
    WHEN 'profil' THEN 'profileComplete'
    WHEN 'first-join' THEN 'firstJoin'
    WHEN 'first-rate' THEN 'firstRate'
    WHEN 'first-host' THEN 'firstHost'
  END;
  v_label text;
  v_new boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Duhet të jesh i kyçur';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Distinktiv i panjohur';
  END IF;

  INSERT INTO public.badges (user_id, badge_id) VALUES (auth.uid(), p_badge)
  ON CONFLICT (user_id, badge_id) DO NOTHING;
  v_new := FOUND;

  IF v_new THEN
    v_label := CASE v_key
      WHEN 'profileComplete' THEN 'Profil i plotë'
      WHEN 'firstJoin' THEN 'Tavolina e parë'
      WHEN 'firstRate' THEN 'Vlerësuesi'
      WHEN 'firstHost' THEN 'Nikoqiri i ri'
    END;
    INSERT INTO public.notifications (user_id, icon, body, kind, params)
    VALUES (auth.uid(), '', 'Fitove distinktivin "' || v_label || '"! Shikoje te Tavolinat e mia.',
            'badgeEarned', jsonb_build_object('badge', v_key, 'label', v_label));
  END IF;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.award_badge(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_badge(text) TO authenticated;

-- Backfill badges people already earned, so nobody gets a "new badge" again after this deploy.
INSERT INTO public.badges (user_id, badge_id)
SELECT DISTINCT host_id, 'first-host' FROM public.tables
UNION SELECT DISTINCT user_id, 'first-join' FROM public.memberships WHERE role = 'member'
UNION SELECT DISTINCT rater_id, 'first-rate' FROM public.ratings
UNION SELECT user_id, 'profil' FROM public.taste_profiles WHERE done
UNION SELECT DISTINCT n.user_id, CASE n.params->>'badge'
    WHEN 'profileComplete' THEN 'profil' WHEN 'firstJoin' THEN 'first-join'
    WHEN 'firstRate' THEN 'first-rate' WHEN 'firstHost' THEN 'first-host' END
  FROM public.notifications n WHERE n.kind = 'badgeEarned' AND n.params ? 'badge'
ON CONFLICT DO NOTHING;

-- Remove the duplicate "badge earned" notifications (keep the first one per user + badge).
DELETE FROM public.notifications n
USING (
  SELECT id, row_number() OVER (PARTITION BY user_id, COALESCE(params->>'badge', params->>'label') ORDER BY created_at, id) AS rn
  FROM public.notifications
  WHERE kind = 'badgeEarned'
) d
WHERE n.id = d.id AND d.rn > 1;

CREATE INDEX IF NOT EXISTS idx_notifications_kind ON public.notifications (kind);

NOTIFY pgrst, 'reload schema';
