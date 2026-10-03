-- ═══════════════════════════════════════════════════════════════════
--  Lessons ("Mësime"): teachers (admin-approved), individual + group lessons,
--  online (private video room) or in person, near-me search.
--
--  Money: the teacher's hourly price is shown and paid to the teacher directly;
--  the student pays the €2 booking fee (recorded as a stub payment until the
--  payment provider is connected, same as tables).
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────── Subject catalogue ─────────────────────────
-- One fixed list, so a student looking for German never sees an English teacher.
CREATE TABLE IF NOT EXISTS public.lesson_subjects (
  id       text PRIMARY KEY,
  category text NOT NULL,
  sort     int NOT NULL DEFAULT 0
);
ALTER TABLE public.lesson_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lesson_subjects_read ON public.lesson_subjects;
CREATE POLICY lesson_subjects_read ON public.lesson_subjects FOR SELECT TO authenticated USING (true);

INSERT INTO public.lesson_subjects (id, category, sort) VALUES
  -- Languages
  ('english','languages',1),('german','languages',2),('french','languages',3),('italian','languages',4),
  ('spanish','languages',5),('turkish','languages',6),('albanian','languages',7),('serbian_croatian','languages',8),
  ('macedonian','languages',9),('russian','languages',10),('arabic','languages',11),('chinese','languages',12),
  ('japanese','languages',13),('swedish','languages',14),('sign_language','languages',15),
  -- School (primary + secondary)
  ('math','school',1),('physics','school',2),('chemistry','school',3),('biology','school',4),
  ('albanian_literature','school',5),('history','school',6),('geography','school',7),('informatics','school',8),
  ('homework_help','school',9),('early_reading','school',10),
  -- University & exams in Kosovo
  ('state_matura','university',1),('university_entrance','university',2),('calculus','university',3),
  ('statistics','university',4),('economics','university',5),('accounting','university',6),('law','university',7),
  ('medicine_prep','university',8),('engineering','university',9),('thesis_help','university',10),
  -- International tests
  ('ielts','tests',1),('toefl','tests',2),('cambridge','tests',3),('goethe','tests',4),('testdaf','tests',5),
  ('delf','tests',6),('sat','tests',7),('gre_gmat','tests',8),
  -- Technology
  ('programming','tech',1),('web_development','tech',2),('mobile_development','tech',3),('data_science','tech',4),
  ('ai_ml','tech',5),('cybersecurity','tech',6),('excel_office','tech',7),('ui_ux_design','tech',8),
  ('graphic_design','tech',9),('digital_marketing','tech',10),
  -- Music
  ('piano','music',1),('guitar','music',2),('violin','music',3),('singing','music',4),('drums','music',5),
  ('music_theory','music',6),('accordion','music',7),
  -- Art & media
  ('drawing_painting','art',1),('photography','art',2),('video_editing','art',3),('calligraphy','art',4),
  -- Sport & wellbeing
  ('personal_training','wellbeing',1),('yoga','wellbeing',2),('swimming','wellbeing',3),('martial_arts','wellbeing',4),
  ('dance','wellbeing',5),('nutrition','wellbeing',6),
  -- Business & career
  ('public_speaking','career',1),('cv_interview','career',2),('entrepreneurship','career',3),
  ('personal_finance','career',4),('sales_marketing','career',5),('project_management','career',6),
  -- Hobbies & life skills
  ('chess','hobbies',1),('cooking','hobbies',2),('driving_theory','hobbies',3),('sewing','hobbies',4),
  ('gardening','hobbies',5)
ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, sort = EXCLUDED.sort;

-- ───────────────────────── Teachers ─────────────────────────
CREATE TABLE IF NOT EXISTS public.tutors (
  user_id          uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  headline         text NOT NULL CHECK (char_length(headline) BETWEEN 5 AND 120),
  bio              text NOT NULL CHECK (char_length(bio) BETWEEN 30 AND 2000),
  subjects         text[] NOT NULL CHECK (cardinality(subjects) BETWEEN 1 AND 12),
  teach_langs      text[] NOT NULL DEFAULT ARRAY['sq'],
  price_cents      int NOT NULL CHECK (price_cents BETWEEN 0 AND 20000),
  online           boolean NOT NULL DEFAULT true,
  in_person        boolean NOT NULL DEFAULT false,
  group_ok         boolean NOT NULL DEFAULT false,
  city             text NOT NULL,
  lat              double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng              double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  years_experience int NOT NULL DEFAULT 0 CHECK (years_experience BETWEEN 0 AND 60),
  education        text CHECK (education IS NULL OR char_length(education) <= 200),
  rejection_reason text,
  reviewed_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (online OR in_person)
);
CREATE INDEX IF NOT EXISTS idx_tutors_status ON public.tutors (status);
CREATE INDEX IF NOT EXISTS idx_tutors_subjects ON public.tutors USING gin (subjects);
ALTER TABLE public.tutors ENABLE ROW LEVEL SECURITY;

-- Validate subjects, keep location approximate (~1 km), and stop users from
-- approving themselves. Editing a rejected application sends it back to review.
CREATE OR REPLACE FUNCTION public.tutors_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.subjects) s WHERE s NOT IN (SELECT id FROM public.lesson_subjects)) THEN
    RAISE EXCEPTION 'Lëndë e panjohur';
  END IF;
  NEW.subjects := ARRAY(SELECT DISTINCT unnest(NEW.subjects));
  NEW.lat := round(NEW.lat::numeric, 2)::double precision;
  NEW.lng := round(NEW.lng::numeric, 2)::double precision;
  NEW.updated_at := now();

  -- App users (auth.uid() set) can never set their own status; the SQL editor /
  -- service role (no auth.uid()) and admins can.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending';
      NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.rejection_reason := NULL;
    ELSE
      NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at;
      NEW.status := CASE WHEN OLD.status = 'rejected' THEN 'pending' ELSE OLD.status END;
      NEW.rejection_reason := CASE WHEN OLD.status = 'rejected' THEN NULL ELSE OLD.rejection_reason END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tutors_before_write ON public.tutors;
CREATE TRIGGER trg_tutors_before_write BEFORE INSERT OR UPDATE ON public.tutors
  FOR EACH ROW EXECUTE FUNCTION public.tutors_before_write();

DROP POLICY IF EXISTS tutors_select ON public.tutors;
CREATE POLICY tutors_select ON public.tutors FOR SELECT TO authenticated
  USING (status = 'approved' OR user_id = auth.uid() OR public.is_admin_user());
DROP POLICY IF EXISTS tutors_insert_own ON public.tutors;
CREATE POLICY tutors_insert_own ON public.tutors FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND onboarded_at IS NOT NULL));
DROP POLICY IF EXISTS tutors_update_own ON public.tutors;
CREATE POLICY tutors_update_own ON public.tutors FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS tutors_delete_own ON public.tutors;
CREATE POLICY tutors_delete_own ON public.tutors FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ───────────────────────── Lessons ─────────────────────────
CREATE TABLE IF NOT EXISTS public.lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id      uuid NOT NULL REFERENCES public.tutors(user_id) ON DELETE CASCADE,
  subject       text NOT NULL REFERENCES public.lesson_subjects(id),
  kind          text NOT NULL CHECK (kind IN ('individual', 'group')),
  title         text CHECK (title IS NULL OR char_length(title) BETWEEN 3 AND 120),
  starts_at     timestamptz NOT NULL,
  duration_min  int NOT NULL CHECK (duration_min IN (30, 45, 60, 90, 120)),
  format        text NOT NULL CHECK (format IN ('online', 'in_person')),
  location_note text CHECK (location_note IS NULL OR char_length(location_note) <= 200),
  max_students  int NOT NULL CHECK (max_students BETWEEN 1 AND 30),
  price_cents   int NOT NULL CHECK (price_cents BETWEEN 0 AND 100000),
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'group' OR max_students = 1)
);
CREATE INDEX IF NOT EXISTS idx_lessons_tutor ON public.lessons (tutor_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_lessons_group_upcoming ON public.lessons (subject, starts_at) WHERE kind = 'group' AND status = 'scheduled';

CREATE TABLE IF NOT EXISTS public.lesson_participants (
  lesson_id  uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'requested'
             CHECK (status IN ('requested', 'accepted', 'confirmed', 'declined', 'cancelled')),
  note       text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_lesson_participants_student ON public.lesson_participants (student_id);

-- Video room names live apart from lessons and are only handed out by
-- get_lesson_room(): to the teacher and confirmed students, around lesson time.
CREATE TABLE IF NOT EXISTS public.lesson_rooms (
  lesson_id uuid PRIMARY KEY REFERENCES public.lessons(id) ON DELETE CASCADE,
  room_key  text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_rooms ENABLE ROW LEVEL SECURITY; -- no policies at all

-- The two policies need each other's table; definer helpers avoid RLS recursion.
CREATE OR REPLACE FUNCTION public._is_lesson_student(p_lesson uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.lesson_participants WHERE lesson_id = p_lesson AND student_id = auth.uid())
$$;
CREATE OR REPLACE FUNCTION public._is_lesson_tutor(p_lesson uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.lessons WHERE id = p_lesson AND tutor_id = auth.uid())
$$;

DROP POLICY IF EXISTS lessons_select ON public.lessons;
CREATE POLICY lessons_select ON public.lessons FOR SELECT TO authenticated USING (
  tutor_id = auth.uid()
  OR public.is_admin_user()
  OR public._is_lesson_student(lessons.id)
  OR (kind = 'group' AND status = 'scheduled' AND starts_at > now()
      AND EXISTS (SELECT 1 FROM public.tutors t WHERE t.user_id = lessons.tutor_id AND t.status = 'approved'))
);
DROP POLICY IF EXISTS lesson_participants_select ON public.lesson_participants;
CREATE POLICY lesson_participants_select ON public.lesson_participants FOR SELECT TO authenticated USING (
  student_id = auth.uid()
  OR public.is_admin_user()
  OR public._is_lesson_tutor(lesson_participants.lesson_id)
);
-- writes go through the RPCs below only

-- €2 booking fee for lessons uses the existing payments table.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_user_lesson ON public.payments (user_id, lesson_id) WHERE lesson_id IS NOT NULL;

-- ───────────────────────── Helpers ─────────────────────────
CREATE OR REPLACE FUNCTION public._distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL
    ELSE 6371 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
  END
$$;

CREATE OR REPLACE FUNCTION public._lesson_notify(p_user uuid, p_kind text, p_params jsonb, p_body text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notifications (user_id, icon, body, kind, params) VALUES (p_user, 'info', p_body, p_kind, p_params)
$$;
REVOKE ALL ON FUNCTION public._lesson_notify(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._require_onboarded_me()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Duhet të jesh i kyçur';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND onboarded_at IS NOT NULL AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'Plotëso profilin (emri, mosha, foto) para se të vazhdosh';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._require_onboarded_me() FROM PUBLIC, anon, authenticated;

-- ───────────────────────── Browse ─────────────────────────
-- Approved teachers, filtered strictly by subject/category, with distance when
-- the student shares a location (or picks a city).
CREATE OR REPLACE FUNCTION public.list_tutors(
  p_subject   text DEFAULT NULL,
  p_category  text DEFAULT NULL,
  p_format    text DEFAULT NULL,      -- 'online' | 'in_person' | NULL
  p_group     boolean DEFAULT NULL,   -- true = offers group lessons
  p_max_price int DEFAULT NULL,
  p_lat       double precision DEFAULT NULL,
  p_lng       double precision DEFAULT NULL,
  p_radius_km double precision DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid, first_name text, last_name text, photo_path text, age int, rating numeric,
  headline text, bio text, subjects text[], teach_langs text[], price_cents int,
  online boolean, in_person boolean, group_ok boolean, city text, years_experience int,
  education text, distance_km double precision, lessons_taught bigint, upcoming_groups bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.user_id, p.first_name, p.last_name, p.photo_path, p.age, p.rating,
         t.headline, t.bio, t.subjects, t.teach_langs, t.price_cents,
         t.online, t.in_person, t.group_ok, t.city, t.years_experience, t.education,
         round(public._distance_km(p_lat, p_lng, t.lat, t.lng)::numeric, 1)::double precision AS distance_km,
         (SELECT count(*) FROM public.lessons l JOIN public.lesson_participants lp ON lp.lesson_id = l.id
            WHERE l.tutor_id = t.user_id AND lp.status = 'confirmed' AND l.starts_at < now()) AS lessons_taught,
         (SELECT count(*) FROM public.lessons l WHERE l.tutor_id = t.user_id AND l.kind = 'group'
            AND l.status = 'scheduled' AND l.starts_at > now()) AS upcoming_groups
  FROM public.tutors t
  JOIN public.profiles p ON p.id = t.user_id
  WHERE auth.uid() IS NOT NULL
    AND t.status = 'approved'
    AND p.deactivated_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.blocks b
                    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = t.user_id)
                       OR (b.blocker_id = t.user_id AND b.blocked_id = auth.uid()))
    AND (p_subject IS NULL OR p_subject = ANY (t.subjects))
    AND (p_category IS NULL OR EXISTS (SELECT 1 FROM public.lesson_subjects s WHERE s.category = p_category AND s.id = ANY (t.subjects)))
    AND (p_format IS NULL OR (p_format = 'online' AND t.online) OR (p_format = 'in_person' AND t.in_person))
    AND (p_group IS NULL OR NOT p_group OR t.group_ok)
    AND (p_max_price IS NULL OR t.price_cents <= p_max_price)
    AND (p_radius_km IS NULL OR p_lat IS NULL OR public._distance_km(p_lat, p_lng, t.lat, t.lng) <= p_radius_km)
  ORDER BY
    CASE WHEN p_lat IS NOT NULL THEN public._distance_km(p_lat, p_lng, t.lat, t.lng) END ASC NULLS LAST,
    p.rating DESC, t.years_experience DESC
  LIMIT 200
$$;

CREATE OR REPLACE FUNCTION public.list_group_lessons(p_subject text DEFAULT NULL, p_category text DEFAULT NULL)
RETURNS TABLE (
  id uuid, tutor_id uuid, tutor_name text, tutor_photo_path text, subject text, title text, starts_at timestamptz,
  duration_min int, format text, location_note text, max_students int, seats_taken bigint, price_cents int, city text, my_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.tutor_id, trim(p.first_name || ' ' || p.last_name), p.photo_path, l.subject, l.title, l.starts_at,
         l.duration_min, l.format, l.location_note, l.max_students,
         (SELECT count(*) FROM public.lesson_participants lp WHERE lp.lesson_id = l.id AND lp.status IN ('accepted', 'confirmed')),
         l.price_cents, t.city,
         (SELECT lp.status FROM public.lesson_participants lp WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid())
  FROM public.lessons l
  JOIN public.tutors t ON t.user_id = l.tutor_id AND t.status = 'approved'
  JOIN public.profiles p ON p.id = l.tutor_id
  WHERE auth.uid() IS NOT NULL AND l.kind = 'group' AND l.status = 'scheduled' AND l.starts_at > now()
    AND (p_subject IS NULL OR l.subject = p_subject)
    AND (p_category IS NULL OR EXISTS (SELECT 1 FROM public.lesson_subjects s WHERE s.id = l.subject AND s.category = p_category))
  ORDER BY l.starts_at
  LIMIT 200
$$;

-- ───────────────────────── Booking flow ─────────────────────────
-- Individual: student requests → teacher accepts → student confirms (€2) → room opens.
CREATE OR REPLACE FUNCTION public.book_lesson(
  p_tutor uuid, p_subject text, p_starts_at timestamptz, p_duration int, p_format text, p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t record; v_id uuid; v_name text;
BEGIN
  PERFORM public._require_onboarded_me();
  SELECT * INTO t FROM public.tutors WHERE user_id = p_tutor AND status = 'approved';
  IF t IS NULL THEN RAISE EXCEPTION 'Mësuesi nuk është i disponueshëm'; END IF;
  IF p_tutor = auth.uid() THEN RAISE EXCEPTION 'Nuk mund të rezervosh mësim me veten'; END IF;
  IF EXISTS (SELECT 1 FROM public.blocks WHERE (blocker_id = p_tutor AND blocked_id = auth.uid()) OR (blocker_id = auth.uid() AND blocked_id = p_tutor)) THEN
    RAISE EXCEPTION 'Veprimi nuk lejohet';
  END IF;
  IF NOT (p_subject = ANY (t.subjects)) THEN RAISE EXCEPTION 'Ky mësues nuk e jep këtë lëndë'; END IF;
  IF p_format NOT IN ('online', 'in_person') OR (p_format = 'online' AND NOT t.online) OR (p_format = 'in_person' AND NOT t.in_person) THEN
    RAISE EXCEPTION 'Ky mësues nuk e ofron këtë mënyrë mësimi';
  END IF;
  IF p_starts_at < now() + interval '30 minutes' OR p_starts_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Zgjidh një orë të paktën 30 minuta nga tani';
  END IF;
  IF (SELECT count(*) FROM public.lessons l JOIN public.lesson_participants lp ON lp.lesson_id = l.id
      WHERE l.tutor_id = p_tutor AND lp.student_id = auth.uid() AND lp.status = 'requested') >= 3 THEN
    RAISE EXCEPTION 'Ke tashmë 3 kërkesa në pritje te ky mësues';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lessons l
             WHERE l.tutor_id = p_tutor AND l.status = 'scheduled'
               AND EXISTS (SELECT 1 FROM public.lesson_participants lp WHERE lp.lesson_id = l.id AND lp.status IN ('accepted', 'confirmed'))
               AND tstzrange(l.starts_at, l.starts_at + make_interval(mins => l.duration_min))
                   && tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration))) THEN
    RAISE EXCEPTION 'Mësuesi është i zënë në këtë orë';
  END IF;

  INSERT INTO public.lessons (tutor_id, subject, kind, starts_at, duration_min, format, max_students, price_cents)
  VALUES (p_tutor, p_subject, 'individual', p_starts_at, p_duration, p_format, 1, round(t.price_cents * p_duration / 60.0))
  RETURNING id INTO v_id;
  INSERT INTO public.lesson_rooms (lesson_id) VALUES (v_id);
  INSERT INTO public.lesson_participants (lesson_id, student_id, status, note)
  VALUES (v_id, auth.uid(), 'requested', NULLIF(trim(COALESCE(p_note, '')), ''));

  SELECT trim(first_name || ' ' || last_name) INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public._lesson_notify(p_tutor, 'lessonRequested',
    jsonb_build_object('name', v_name, 'subject', p_subject, 'at', p_starts_at),
    v_name || ' kërkon një mësim me ty.');
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_lesson_request(p_lesson uuid, p_student uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE l record; v_name text;
BEGIN
  SELECT * INTO l FROM public.lessons WHERE id = p_lesson;
  IF l IS NULL OR l.tutor_id <> auth.uid() THEN RAISE EXCEPTION 'Vetëm mësuesi mund të përgjigjet'; END IF;
  UPDATE public.lesson_participants SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
  WHERE lesson_id = p_lesson AND student_id = p_student AND status = 'requested';
  IF NOT FOUND THEN RAISE EXCEPTION 'Kërkesa nuk u gjet'; END IF;
  IF NOT p_accept AND l.kind = 'individual' THEN
    UPDATE public.lessons SET status = 'cancelled' WHERE id = p_lesson;
  END IF;
  SELECT trim(first_name || ' ' || last_name) INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public._lesson_notify(p_student, CASE WHEN p_accept THEN 'lessonAccepted' ELSE 'lessonDeclined' END,
    jsonb_build_object('name', v_name, 'subject', l.subject, 'at', l.starts_at),
    CASE WHEN p_accept THEN v_name || ' e pranoi mësimin. Konfirmo rezervimin.' ELSE v_name || ' nuk mund ta mbajë këtë mësim.' END);
END;
$$;

-- Group: teacher publishes, students join (accepted) then confirm (€2).
CREATE OR REPLACE FUNCTION public.create_group_lesson(
  p_subject text, p_title text, p_starts_at timestamptz, p_duration int, p_format text,
  p_max_students int, p_price_cents int, p_location_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t record; v_id uuid;
BEGIN
  PERFORM public._require_onboarded_me();
  SELECT * INTO t FROM public.tutors WHERE user_id = auth.uid() AND status = 'approved';
  IF t IS NULL THEN RAISE EXCEPTION 'Vetëm mësuesit e aprovuar hapin mësime në grup'; END IF;
  IF NOT t.group_ok THEN RAISE EXCEPTION 'Aktivizo mësimet në grup te profili yt i mësuesit'; END IF;
  IF NOT (p_subject = ANY (t.subjects)) THEN RAISE EXCEPTION 'Ky mësues nuk e jep këtë lëndë'; END IF;
  IF (p_format = 'online' AND NOT t.online) OR (p_format = 'in_person' AND NOT t.in_person) THEN
    RAISE EXCEPTION 'Ky mësues nuk e ofron këtë mënyrë mësimi';
  END IF;
  IF p_starts_at < now() + interval '30 minutes' THEN RAISE EXCEPTION 'Zgjidh një orë të paktën 30 minuta nga tani'; END IF;
  IF p_max_students NOT BETWEEN 2 AND 30 THEN RAISE EXCEPTION 'Grupi ka 2 deri 30 studentë'; END IF;
  IF p_format = 'in_person' AND NULLIF(trim(COALESCE(p_location_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Shkruaj vendin e mësimit';
  END IF;

  INSERT INTO public.lessons (tutor_id, subject, kind, title, starts_at, duration_min, format, location_note, max_students, price_cents)
  VALUES (auth.uid(), p_subject, 'group', trim(p_title), p_starts_at, p_duration, p_format,
          NULLIF(trim(COALESCE(p_location_note, '')), ''), p_max_students, GREATEST(0, p_price_cents))
  RETURNING id INTO v_id;
  INSERT INTO public.lesson_rooms (lesson_id) VALUES (v_id);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_group_lesson(p_lesson uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE l record; v_taken int;
BEGIN
  PERFORM public._require_onboarded_me();
  SELECT * INTO l FROM public.lessons WHERE id = p_lesson AND kind = 'group' AND status = 'scheduled' FOR UPDATE;
  IF l IS NULL OR l.starts_at <= now() THEN RAISE EXCEPTION 'Mësimi nuk është i disponueshëm'; END IF;
  IF l.tutor_id = auth.uid() THEN RAISE EXCEPTION 'Nuk mund t''i bashkohesh mësimit tënd'; END IF;
  IF EXISTS (SELECT 1 FROM public.blocks WHERE (blocker_id = l.tutor_id AND blocked_id = auth.uid()) OR (blocker_id = auth.uid() AND blocked_id = l.tutor_id)) THEN
    RAISE EXCEPTION 'Veprimi nuk lejohet';
  END IF;
  SELECT count(*) INTO v_taken FROM public.lesson_participants WHERE lesson_id = p_lesson AND status IN ('accepted', 'confirmed');
  IF v_taken >= l.max_students THEN RAISE EXCEPTION 'Grupi është plot'; END IF;
  INSERT INTO public.lesson_participants (lesson_id, student_id, status) VALUES (p_lesson, auth.uid(), 'accepted')
  ON CONFLICT (lesson_id, student_id) DO UPDATE SET status = 'accepted'
    WHERE public.lesson_participants.status IN ('cancelled', 'declined');
END;
$$;

-- Student confirms an accepted seat: records the €2 booking fee (stub until the
-- payment provider webhook exists) and unlocks the video room.
CREATE OR REPLACE FUNCTION public.confirm_lesson_seat(p_lesson uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE l record; v_ticket text; v_name text;
BEGIN
  SELECT * INTO l FROM public.lessons WHERE id = p_lesson AND status = 'scheduled';
  IF l IS NULL OR l.starts_at + make_interval(mins => l.duration_min) <= now() THEN RAISE EXCEPTION 'Mësimi nuk është i disponueshëm'; END IF;
  UPDATE public.lesson_participants SET status = 'confirmed'
  WHERE lesson_id = p_lesson AND student_id = auth.uid() AND status = 'accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'Mësuesi nuk e ka pranuar ende kërkesën'; END IF;

  v_ticket := 'EBM-' || lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
  INSERT INTO public.payments (user_id, table_id, lesson_id, amount_cents, provider, provider_ref, ticket_code, table_title)
  VALUES (auth.uid(), NULL, p_lesson, 200, 'stub', 'STUB-L-' || floor(extract(epoch FROM now()) * 1000)::bigint, v_ticket, 'Mësim: ' || l.subject)
  ON CONFLICT DO NOTHING;

  SELECT trim(first_name || ' ' || last_name) INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public._lesson_notify(l.tutor_id, 'lessonConfirmed',
    jsonb_build_object('name', v_name, 'subject', l.subject, 'at', l.starts_at),
    v_name || ' e konfirmoi mësimin.');
  RETURN v_ticket;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_lesson(p_lesson uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE l record; s record; v_name text;
BEGIN
  SELECT * INTO l FROM public.lessons WHERE id = p_lesson;
  IF l IS NULL THEN RAISE EXCEPTION 'Mësimi nuk u gjet'; END IF;
  SELECT trim(first_name || ' ' || last_name) INTO v_name FROM public.profiles WHERE id = auth.uid();

  IF l.tutor_id = auth.uid() THEN
    UPDATE public.lessons SET status = 'cancelled' WHERE id = p_lesson;
    FOR s IN SELECT student_id FROM public.lesson_participants WHERE lesson_id = p_lesson AND status IN ('requested', 'accepted', 'confirmed') LOOP
      PERFORM public._lesson_notify(s.student_id, 'lessonCancelled',
        jsonb_build_object('name', v_name, 'subject', l.subject, 'at', l.starts_at), v_name || ' e anuloi mësimin.');
    END LOOP;
    UPDATE public.lesson_participants SET status = 'cancelled' WHERE lesson_id = p_lesson AND status IN ('requested', 'accepted', 'confirmed');
  ELSE
    UPDATE public.lesson_participants SET status = 'cancelled'
    WHERE lesson_id = p_lesson AND student_id = auth.uid() AND status IN ('requested', 'accepted', 'confirmed');
    IF NOT FOUND THEN RAISE EXCEPTION 'Mësimi nuk u gjet'; END IF;
    IF l.kind = 'individual' THEN UPDATE public.lessons SET status = 'cancelled' WHERE id = p_lesson; END IF;
    PERFORM public._lesson_notify(l.tutor_id, 'lessonCancelled',
      jsonb_build_object('name', v_name, 'subject', l.subject, 'at', l.starts_at), v_name || ' e anuloi mësimin.');
  END IF;
END;
$$;

-- The room opens 15 min before and closes 30 min after the lesson, only for the
-- teacher and confirmed students.
CREATE OR REPLACE FUNCTION public.get_lesson_room(p_lesson uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE l record; v_key text;
BEGIN
  SELECT * INTO l FROM public.lessons WHERE id = p_lesson AND status = 'scheduled' AND format = 'online';
  IF l IS NULL THEN RAISE EXCEPTION 'Mësimi nuk u gjet'; END IF;
  IF NOT (l.tutor_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.lesson_participants WHERE lesson_id = p_lesson AND student_id = auth.uid() AND status = 'confirmed')) THEN
    RAISE EXCEPTION 'Nuk ke qasje në këtë mësim';
  END IF;
  IF now() < l.starts_at - interval '15 minutes' THEN
    RAISE EXCEPTION 'Dhoma hapet 15 minuta para mësimit';
  END IF;
  IF now() > l.starts_at + make_interval(mins => l.duration_min) + interval '30 minutes' THEN
    RAISE EXCEPTION 'Mësimi ka përfunduar';
  END IF;
  SELECT room_key INTO v_key FROM public.lesson_rooms WHERE lesson_id = p_lesson;
  RETURN jsonb_build_object('room', 'ejaBashkohu-' || v_key, 'starts_at', l.starts_at, 'duration_min', l.duration_min);
END;
$$;

CREATE OR REPLACE FUNCTION public.my_lessons()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'as_student', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.starts_at DESC) FROM (
        SELECT l.id, l.kind, l.subject, l.title, l.starts_at, l.duration_min, l.format, l.location_note, l.price_cents,
               l.status AS lesson_status, lp.status AS my_status, l.tutor_id,
               trim(p.first_name || ' ' || p.last_name) AS tutor_name, p.photo_path AS tutor_photo_path,
               (SELECT ticket_code FROM public.payments pay WHERE pay.lesson_id = l.id AND pay.user_id = auth.uid() LIMIT 1) AS ticket_code
        FROM public.lesson_participants lp
        JOIN public.lessons l ON l.id = lp.lesson_id
        JOIN public.profiles p ON p.id = l.tutor_id
        WHERE lp.student_id = auth.uid()
        ORDER BY l.starts_at DESC LIMIT 100) x), '[]'::jsonb),
    'as_tutor', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.starts_at DESC) FROM (
        SELECT l.id, l.kind, l.subject, l.title, l.starts_at, l.duration_min, l.format, l.location_note, l.price_cents,
               l.status AS lesson_status, l.max_students,
               COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'student_id', lp.student_id, 'status', lp.status, 'note', lp.note,
                  'name', trim(sp.first_name || ' ' || sp.last_name), 'photo_path', sp.photo_path, 'age', sp.age))
                FROM public.lesson_participants lp JOIN public.profiles sp ON sp.id = lp.student_id
                WHERE lp.lesson_id = l.id), '[]'::jsonb) AS students
        FROM public.lessons l
        WHERE l.tutor_id = auth.uid()
        ORDER BY l.starts_at DESC LIMIT 100) x), '[]'::jsonb),
    'tutor', (SELECT to_jsonb(t) FROM public.tutors t WHERE t.user_id = auth.uid())
  )
$$;

-- ───────────────────────── Admin: approve teachers ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_tutors(p_status text DEFAULT 'pending')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_guard();
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
      SELECT t.*, p.first_name, p.last_name, p.photo_path, p.age, u.email,
             trim(rv.first_name || ' ' || rv.last_name) AS reviewed_by_name,
             (SELECT count(*) FROM public.lessons l WHERE l.tutor_id = t.user_id) AS lessons_count,
             (SELECT count(*) FROM public.reports r WHERE r.reported_id = t.user_id) AS reports_against
      FROM public.tutors t
      JOIN public.profiles p ON p.id = t.user_id
      LEFT JOIN auth.users u ON u.id = t.user_id
      LEFT JOIN public.profiles rv ON rv.id = t.reviewed_by
      WHERE p_status IS NULL OR p_status = 'all' OR t.status = p_status
      LIMIT 500) x), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_tutor(p_user uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  PERFORM public._admin_guard();
  IF p_status NOT IN ('approved', 'rejected', 'suspended') THEN RAISE EXCEPTION 'Status i pavlefshëm'; END IF;
  IF p_status IN ('rejected', 'suspended') AND v_reason IS NULL THEN RAISE EXCEPTION 'Shkruaj arsyen'; END IF;
  UPDATE public.tutors
  SET status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = CASE WHEN p_status = 'approved' THEN NULL ELSE v_reason END
  WHERE user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aplikimi nuk u gjet'; END IF;

  PERFORM public._lesson_notify(p_user,
    CASE p_status WHEN 'approved' THEN 'tutorApproved' WHEN 'rejected' THEN 'tutorRejected' ELSE 'tutorSuspended' END,
    jsonb_build_object('reason', v_reason),
    CASE p_status WHEN 'approved' THEN 'Profili yt i mësuesit u aprovua! Studentët tani mund të të gjejnë.'
                  ELSE 'Profili yt i mësuesit nuk u aprovua. Arsyeja: ' || v_reason END);
  PERFORM public._admin_log('tutor_' || p_status, 'user', p_user, public._admin_user_label(p_user),
                            jsonb_build_object('reason', v_reason));
END;
$$;

-- ───────────────────────── Grants ─────────────────────────
-- Explicit table privileges (RLS above still decides which rows). lesson_rooms
-- gets none: room names only come out of get_lesson_room().
GRANT SELECT ON public.lesson_subjects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutors TO authenticated;
GRANT SELECT ON public.lessons, public.lesson_participants TO authenticated;
REVOKE ALL ON public.lesson_rooms FROM PUBLIC, anon, authenticated;
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.list_tutors(text, text, text, boolean, int, double precision, double precision, double precision)',
    'public.list_group_lessons(text, text)',
    'public.book_lesson(uuid, text, timestamptz, int, text, text)',
    'public.respond_lesson_request(uuid, uuid, boolean)',
    'public.create_group_lesson(text, text, timestamptz, int, text, int, int, text)',
    'public.join_group_lesson(uuid)',
    'public.confirm_lesson_seat(uuid)',
    'public.cancel_lesson(uuid)',
    'public.get_lesson_room(uuid)',
    'public.my_lessons()',
    'public.admin_list_tutors(text)',
    'public.admin_review_tutor(uuid, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
