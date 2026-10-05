"""Group A: tables, requests, social, onboarding."""
ANA = 'ana.petrovska@gmail.com'        # Prishtinë
AGON = 'agon.begolli@gmail.com'        # Ferizaj
RINA = 'rina.halili@gmail.com'         # Pejë
BLERIM = 'blerim.gashi@gmail.com'      # Prishtinë
ARTA = 'arta.krasniqi@gmail.com'       # Prishtinë
NORA = 'nora.rama@gmail.com'           # Prishtinë
MIA = 'mia.fischer@gmail.com'          # tutor of the seeded lessons


def q(table, action='select', **kw):
    d = {'table': table, 'action': action}
    d.update(kw)
    return d


def new_table(title, host=ANA, **kw):
    v = {'kind': 'tavoline', 'category': 'food', 'title': title, 'city': 'Prishtinë',
         'time_label': '20:00', 'spots': 4, 'event_datetime': '$now+3d', 'host_id': '$user:' + host}
    v.update(kw)
    return {'as': host, 'query': q('tables', 'insert', values=v, returning=True, single=True)}


def rpc(who, name, **args):
    return {'as': who, 'rpc': name, 'args': args}


def reqs(ref='$0.data.id'):
    return {'as': ANA, 'query': q('requests', select='user_id,status',
                                      filters=[{'col': 'table_id', 'op': 'eq', 'value': ref}],
                                      order=[{'col': 'user_id'}])}


LESSON = '11111111-1111-1111-1111-111111111111'
MAKE_LESSON = [
    {'sql': "insert into public.tutors (user_id, status, headline, bio, subjects, price_cents, city)"
            " select id, 'approved', 'Tutor', repeat('bio text ', 5), array['english'], 1000, 'Prishtinë'"
            " from auth.users where email = 'mia.fischer@gmail.com'"},
    {'sql': "insert into public.lessons (id, tutor_id, subject, kind, starts_at, duration_min, format, max_students, price_cents)"
            " select '11111111-1111-1111-1111-111111111111', id, 'english', 'group', '2030-01-01', 60, 'online', 5, 0"
            " from auth.users where email = 'mia.fischer@gmail.com'"},
]

# trg_email_request only exists in production (not in the dev DB), while hooks.request_after_save
# always enqueues the 'notify-email' job: backend.jobs is ignored in cases that create requests.
JOBS = ()  # the legacy DB now has production's email trigger, so jobs are compared too

CASES = [
    {'name': 'request_join / approve / reject / leave flow', 'ignore_tables': JOBS,
     'steps': [new_table('TA flow'),
               rpc(BLERIM, 'request_join', p_table='$0.data.id'),
               rpc(BLERIM, 'request_join', p_table='$0.data.id'),            # unique violation
               rpc(ANA, 'request_join', p_table='$0.data.id'),               # host
               rpc(AGON, 'reject_request', p_request='$1'),             # not host: no-op
               rpc(BLERIM, 'approve_request', p_request='$1'),          # not host
               rpc(ANA, 'approve_request', p_request='$1'),
               rpc(ANA, 'approve_request', p_request='$1'),             # no longer pending
               rpc(BLERIM, 'confirm_free_seat', p_table='$0.data.id'),       # not a ride
               rpc(BLERIM, '_is_table_participant', p_table='$0.data.id'),
               rpc(ARTA, '_is_table_participant', p_table='$0.data.id'),
               rpc(ARTA, 'request_join', p_table='$0.data.id'),
               rpc(ANA, 'reject_request', p_request='$11'),
               rpc(ANA, 'reject_request', p_request='$11'),
               rpc(ANA, 'reject_request', p_request='00000000-0000-0000-0000-000000000000'),
               reqs(),
               rpc(BLERIM, 'leave_table', p_table='$0.data.id'),
               rpc(ANA, 'leave_table', p_table='$0.data.id'),                # host membership stays
               rpc(None, 'leave_table', p_table='$0.data.id'),
               reqs(),
               rpc(None, 'request_join', p_table='$0.data.id'),
               rpc(BLERIM, 'request_join', p_table='nope'),
               rpc(BLERIM, 'request_join', p_table='00000000-0000-0000-0000-000000000000'),
               rpc(BLERIM, 'approve_request', p_request='00000000-0000-0000-0000-000000000000')]},
    # Intentional change: signed-out approve_request used to approve (NULL comparison
    # in the SQL); it is refused now. Results/effects of that step differ on purpose;
    # dev/tests_intentional.py checks the new behaviour.
    {'name': 'approve/reject signed out', 'ignore_tables': JOBS + ('requests', 'notifications', 'tables'),
     'steps': [new_table('TA anon'),
               rpc(BLERIM, 'request_join', p_table='$0.data.id'),
               rpc(ARTA, 'request_join', p_table='$0.data.id'),
               rpc(None, 'reject_request', p_request='$2'),
               dict(rpc(None, 'approve_request', p_request='$1'), expect_diff='signed-out approve now refused'),
               dict(reqs(), expect_diff='follows from the step above')]},
    {'name': 'request_join errors: expired, closed, full, blocked', 'ignore_tables': JOBS,
     'steps': [new_table('TA exp'), new_table('TA closed', host=NORA), new_table('TA full', host=NORA, spots=1), new_table('TA block'),
               {'sql': "alter table public.tables drop constraint event_datetime_future"},
               {'sql': "update public.tables set event_datetime = '2026-01-01T12:00:00Z' where title = 'TA exp'"},
               {'sql': "update public.tables set status = 'cancelled' where title = 'TA closed'"},
               {'sql': "insert into public.blocks (blocker_id, blocked_id) select a.id, b.id from auth.users a, auth.users b"
                       " where a.email = 'blerim.gashi@gmail.com' and b.email = 'ana.petrovska@gmail.com'"},
               rpc(ARTA, 'request_join', p_table='$0.data.id'),
               rpc(ARTA, 'request_join', p_table='$1.data.id'),
               rpc(ARTA, 'request_join', p_table='$2.data.id'),
               rpc(BLERIM, 'request_join', p_table='$3.data.id'),
               rpc(BLERIM, 'request_join', p_table='$2.data.id'),            # full (not blocked by NORA)
               ]},
    {'name': 'confirm_free_seat (ride)', 'ignore_tables': JOBS,
     'steps': [new_table('TA ride', kind='vozitje', category='ride', to_city='Prizren', spots=2),
               rpc(BLERIM, 'request_join', p_table='$0.data.id'),
               rpc(ARTA, 'request_join', p_table='$0.data.id'),
               rpc(NORA, 'request_join', p_table='$0.data.id'),
               rpc(ANA, 'approve_request', p_request='$1'),
               rpc(ANA, 'approve_request', p_request='$2'),
               rpc(NORA, 'confirm_free_seat', p_table='$0.data.id'),         # not approved
               rpc(None, 'confirm_free_seat', p_table='$0.data.id'),
               rpc(BLERIM, 'confirm_free_seat', p_table='$0.data.id'),
               rpc(BLERIM, 'confirm_free_seat', p_table='$0.data.id'),       # already confirmed
               rpc(ARTA, 'confirm_free_seat', p_table='$0.data.id'),         # seats full
               rpc(ARTA, 'confirm_free_seat', p_table='00000000-0000-0000-0000-000000000000'),
               reqs(),
               rpc(BLERIM, 'leave_table', p_table='$0.data.id'),
               reqs()]},
    {'name': 'award_badge',
     'steps': [rpc(ARTA, 'award_badge', p_badge='profil'),
               rpc(ARTA, 'award_badge', p_badge='profil'),
               rpc(ARTA, 'award_badge', p_badge='first-host'),
               rpc(ARTA, 'award_badge', p_badge='first-join'),
               rpc(ARTA, 'award_badge', p_badge='first-rate'),
               rpc(ARTA, 'award_badge', p_badge='nope'),
               rpc(ARTA, 'award_badge', p_badge=None),
               rpc(None, 'award_badge', p_badge='profil')]},
    {'name': 'complete_onboarding',
     'steps': [rpc(ARTA, 'complete_onboarding', p_first_name='  Arta ', p_last_name='K', p_age=30),
               rpc(ARTA, 'complete_onboarding', p_first_name='Arta', p_last_name='K', p_age=31, p_is_tourist=True, p_from_place='  Berlin '),
               rpc(BLERIM, 'complete_onboarding', p_first_name='B', p_last_name='G', p_age=40, p_is_tourist=True, p_from_place='  '),
               rpc(NORA, 'complete_onboarding', p_first_name='N', p_last_name='R', p_age=20, p_is_tourist=None, p_from_place='X'),
               rpc(ARTA, 'complete_onboarding', p_first_name='Përdorues', p_last_name='K', p_age=30),
               rpc(ARTA, 'complete_onboarding', p_first_name='A', p_last_name='-', p_age=30),
               rpc(ARTA, 'complete_onboarding', p_first_name=' ', p_last_name='K', p_age=30),
               rpc(ARTA, 'complete_onboarding', p_first_name=None, p_last_name='K', p_age=30),
               rpc(ARTA, 'complete_onboarding', p_first_name='A' * 41, p_last_name='K', p_age=30),
               rpc(ARTA, 'complete_onboarding', p_first_name='A', p_last_name='K', p_age=17),
               rpc(ARTA, 'complete_onboarding', p_first_name='A', p_last_name='K', p_age=100),
               rpc(ARTA, 'complete_onboarding', p_first_name='A', p_last_name='K', p_age=None),
               rpc(ARTA, 'complete_onboarding', p_first_name='A', p_last_name='K'),
               rpc(None, 'complete_onboarding', p_first_name='A', p_last_name='K', p_age=30),
               {'sql': "update public.profiles set onboarded_at = null where id = (select id from auth.users where email = 'nora.rama@gmail.com')"},
               rpc(NORA, 'complete_onboarding', p_first_name='Nora', p_last_name='Rama', p_age=25)]},
    {'name': 'set_home_city',
     'steps': [rpc(ARTA, 'set_home_city', p_city=' Prishtinë '),            # unchanged
               rpc(ARTA, 'set_home_city', p_city='Pejë'),
               rpc(ARTA, 'set_home_city', p_city='Ferizaj'),                # 30 days
               rpc(ARTA, 'set_home_city', p_city='Pejë'),                   # same again: fine
               rpc(ARTA, 'set_home_city', p_city='  '),
               rpc(ARTA, 'set_home_city', p_city=None),
               rpc(ARTA, 'set_home_city', p_city='x' * 61),
               rpc(None, 'set_home_city', p_city='Pejë'),
               rpc('admin', 'set_home_city', p_city='Prizren'),             # from NULL: changed_at stays NULL
               rpc('admin', 'set_home_city', p_city='Pejë'),
               rpc('admin', 'set_home_city', p_city='Gjakovë'),
               {'sql': "update public.profiles set home_city_changed_at = now() - interval '31 days'"
                       " where id = (select id from auth.users where email = 'arta.krasniqi@gmail.com')"},
               rpc(ARTA, 'set_home_city', p_city='Ferizaj')]},
    {'name': 'set_home_city premium',
     'steps': [{'sql': "insert into public.subscriptions (user_id, plan_id, starts_at, ends_at, source)"
                       " select id, 'premium_1m', '2026-01-01', '2030-01-01', 'admin_grant'"
                       " from auth.users where email = 'blerim.gashi@gmail.com'"},
               rpc(BLERIM, 'set_home_city', p_city='Pejë'),
               rpc(BLERIM, 'set_home_city', p_city='Ferizaj')]},
    {'name': 'table_share_preview visibility',
     'steps': [rpc(w, 'table_share_preview', p_code=c)
               for c in ('a5w78jsx', 'A5W78JSX', 'gf9raaef', 'rhwrnahs', 'tmu46hn9')
               for w in (ANA, RINA, AGON, None, 'admin')]
     + [rpc(ANA, 'table_share_preview', p_code="$sql:select id::text from tables where share_code = 'a5w78jsx'"),
        rpc(RINA, 'table_share_preview', p_code="$sql:select upper(id::text) from tables where share_code = 'a5w78jsx'"),
        rpc(ANA, 'table_share_preview', p_code='nothere1'),
        rpc(ANA, 'table_share_preview', p_code=None),
        rpc(ANA, 'table_share_preview', p_code='x' * 65),
        rpc(ANA, 'table_share_preview', p_code=''),
        rpc(ANA, 'table_share_preview', p_code='-' * 36),
        rpc(ANA, 'table_share_preview', p_code='00000000-0000-0000-0000-000000000000'),
        rpc(ANA, 'table_share_preview')]},
    {'name': 'table_share_preview: secret, blocked, member, wednesday, full/past',
     'steps': [new_table('TA share', area='Qendra', women_only=True),
               {'sql': "update public.tables set mystery = true, revealed = false where title = 'TA share'"},
               rpc(ANA, 'table_share_preview', p_code='$0.data.share_code'),
               rpc(None, 'table_share_preview', p_code='$0.data.share_code'),
               rpc(AGON, 'table_share_preview', p_code='$0.data.share_code'),    # other city
               {'sql': "insert into public.blocks (blocker_id, blocked_id) select a.id, b.id from auth.users a, auth.users b"
                       " where a.email = 'blerim.gashi@gmail.com' and b.email = 'ana.petrovska@gmail.com'"},
               rpc(BLERIM, 'table_share_preview', p_code='$0.data.share_code'),  # hidden -> null
               rpc(RINA, 'table_share_preview', p_code='a5w78jsx'),
               # AGON is a member of a Prishtinë table hosted by someone else
               rpc(AGON, 'table_share_preview', p_code="$sql:select t.share_code from tables t join memberships m on m.table_id = t.id"
                                                       " join auth.users u on u.id = m.user_id where u.email = 'agon.begolli@gmail.com'"
                                                       " and t.city = 'Prishtinë' and t.host_id <> u.id order by t.id limit 1"),
               {'sql': "update public.tables set kind = 'darka_e_merkures' where title = 'TA share'"},
               rpc(ANA, 'table_share_preview', p_code='$0.data.share_code')]},
    {'name': 'lesson / participant helpers',
     'steps': MAKE_LESSON + [rpc(MIA, '_is_lesson_tutor', p_lesson=LESSON),
               rpc(ANA, '_is_lesson_tutor', p_lesson=LESSON),
               rpc(None, '_is_lesson_tutor', p_lesson=LESSON),
               rpc(ANA, '_is_lesson_student', p_lesson=LESSON),
               {'sql': "insert into public.lesson_participants (lesson_id, student_id, status)"
                       " select '11111111-1111-1111-1111-111111111111', id, 'requested' from auth.users where email = 'ana.petrovska@gmail.com'"},
               rpc(ANA, '_is_lesson_student', p_lesson=LESSON),
               rpc(BLERIM, '_is_lesson_student', p_lesson=LESSON),
               rpc(None, '_is_lesson_student', p_lesson=LESSON),
               rpc(ANA, '_is_lesson_student', p_lesson='bad'),
               rpc(None, '_is_table_participant', p_table='$tbl:Baklori')]},
    {'name': 'pure helpers',
     'steps': [rpc(None, '_distance_km', lat1=42.6629, lng1=21.1655, lat2=42.2139, lng2=20.7397),
               rpc(None, '_distance_km', lat1=42.0, lng1=21.0, lat2=42.0, lng2=21.0),
               rpc(None, '_distance_km', lat1=None, lng1=21.0, lat2=42.0, lng2=21.0),
               rpc(None, '_distance_km', lat1='x', lng1=21.0, lat2=42.0, lng2=21.0),
               rpc(None, '_distance_km', lat1=90, lng1=0, lat2=-90, lng2=0),
               rpc(None, '_month_start'),
               rpc(ANA, '_next_wednesday_dinner'),
               dict(rpc(None, '_kosovo_now'), expect_diff='wall clock now (+2h, not normalised); checked separately'),
               dict(rpc(ANA, '_new_share_code'), expect_diff='random'),
               rpc(None, '_new_share_code')]},
]
