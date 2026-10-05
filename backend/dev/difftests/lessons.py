"""Group B: lessons and tutors."""
T = 'arta.krasniqi@gmail.com'        # tutor
T2 = 'mia.fischer@gmail.com'         # tutor blocked by AGON
S = 'blerim.gashi@gmail.com'         # student
S2 = 'donika.berisha@gmail.com'      # student
S3 = 'erion.morina@gmail.com'
AGON = 'agon.begolli@gmail.com'      # blocks MIA
NEW = 'stefan.jovanov@gmail.com'     # not onboarded


def q(table, action='select', **kw):
    d = {'table': table, 'action': action}
    d.update(kw)
    return d


def apply(user, **over):
    v = {'user_id': '$user:' + user, 'headline': 'Mësues i matematikës',
         'bio': 'Jap mësim matematike dhe programimi prej shumë vitesh me studentë.',
         'subjects': ['math', 'programming'], 'price_cents': 1500, 'city': 'Prishtinë',
         'online': True, 'in_person': True, 'group_ok': True, 'lat': 42.66, 'lng': 21.16,
         'years_experience': 5, 'status': 'approved'}
    v.update(over)
    return {'as': user, 'query': q('tutors', 'insert', values=v)}


def approve(user):
    return {'as': 'admin', 'rpc': 'admin_review_tutor', 'args': {'p_user': '$user:' + user, 'p_status': 'approved'}}


SETUP = [apply(T), approve(T)]                                   # steps 0-1
BOOK = {'as': S, 'rpc': 'book_lesson', 'args': {'p_tutor': '$user:' + T, 'p_subject': 'math',
                                                 'p_starts_at': '$now+3d', 'p_duration': 45, 'p_format': 'online',
                                                 'p_note': '  Algjebër  '}}
GROUP = {'as': T, 'rpc': 'create_group_lesson', 'args': {
    'p_subject': 'programming', 'p_title': '  Python për fillestarë ', 'p_starts_at': '$now+5d', 'p_duration': 90,
    'p_format': 'online', 'p_max_students': 2, 'p_price_cents': 500}}
MY = {'rpc': 'my_lessons'}
ROOM = 'room key is random (room = ejaBashkohu-<key>)'
TICKET = 'ticket code is random (EBM-xxxx)'

# Setup run first in every case (same position on both sides):
#  - serial ids (admin_audit_log) are not rolled back between the two sides: align the sequence;
#  - the SQL trigger tutors_before_write dedups subjects with ARRAY(SELECT DISTINCT unnest(..)),
#    whose order is undefined (hash aggregate); the Python hook sorts them. Make the SQL side
#    deterministic (sorted, rolled back with the case) so the rest can be compared.
SEQ = {'sql': "select setval(pg_get_serial_sequence('public.admin_audit_log', 'id'), coalesce((select max(id) from public.admin_audit_log), 0) + 1, false);"
              " do $x$ begin execute replace(pg_get_functiondef('public.tutors_before_write'::regproc),"
              " 'SELECT DISTINCT unnest(NEW.subjects)', 'SELECT DISTINCT s COLLATE \"C\" FROM unnest(NEW.subjects) s ORDER BY 1'); end $x$"}

CASES = [
    {'name': 'apply + admin list/review', 'unordered': True,  # ORDER BY created_at DESC: ties (same now())
     'steps': [SEQ, apply(T), apply(T2, subjects=['english'], online=False, lat=None, lng=None, education='BA'),
               {'as': 'admin', 'rpc': 'admin_list_tutors'},
               {'as': 'admin', 'rpc': 'admin_list_tutors', 'args': {'p_status': 'all'}},
               {'as': 'admin', 'rpc': 'admin_list_tutors', 'args': {'p_status': None}},
               {'as': 'admin', 'rpc': 'admin_list_tutors', 'args': {'p_status': 'approved'}},
               {'as': S, 'rpc': 'admin_list_tutors'},
               {'as': None, 'rpc': 'admin_list_tutors'},
               approve(T),
               {'as': 'admin', 'rpc': 'admin_review_tutor', 'args': {'p_user': '$user:' + T2, 'p_status': 'rejected', 'p_reason': '  '}},
               {'as': 'admin', 'rpc': 'admin_review_tutor', 'args': {'p_user': '$user:' + T2, 'p_status': 'rejected', 'p_reason': ' Bio e dobët '}},
               {'as': 'admin', 'rpc': 'admin_review_tutor', 'args': {'p_user': '$user:' + T, 'p_status': 'suspended', 'p_reason': 'Ankesa'}},
               {'as': 'admin', 'rpc': 'admin_review_tutor', 'args': {'p_user': '$user:' + T, 'p_status': 'approved', 'p_reason': 'x'}},
               {'as': 'admin', 'rpc': 'admin_review_tutor', 'args': {'p_user': '$user:' + T, 'p_status': 'bad'}},
               {'as': 'admin', 'rpc': 'admin_review_tutor', 'args': {'p_user': '$user:' + S, 'p_status': 'approved'}},
               {'as': S, 'rpc': 'admin_review_tutor', 'args': {'p_user': '$user:' + T, 'p_status': 'approved'}},
               {'as': 'admin', 'rpc': 'admin_list_tutors', 'args': {'p_status': 'all'}},
               {'as': T, 'rpc': 'my_lessons'}]},
    {'name': 'list_tutors filters',
     'steps': [SEQ] + SETUP + [apply(T2, subjects=['english'], online=False, group_ok=False, price_cents=3000, lat=42.0, lng=20.9), approve(T2),
                       apply(S3, subjects=['piano']),                     # pending, never listed
                       {'as': S, 'rpc': 'list_tutors'},
                       {'as': S, 'rpc': 'list_tutors', 'args': {'p_subject': 'math'}},
                       {'as': S, 'rpc': 'list_tutors', 'args': {'p_category': 'languages'}},
                       {'as': S, 'rpc': 'list_tutors', 'args': {'p_format': 'online'}},
                       {'as': S, 'rpc': 'list_tutors', 'args': {'p_format': 'in_person'}},
                       {'as': S, 'rpc': 'list_tutors', 'args': {'p_group': True}},
                       {'as': S, 'rpc': 'list_tutors', 'args': {'p_group': False, 'p_max_price': 2000}},
                       {'as': S, 'rpc': 'list_tutors', 'args': {'p_lat': 42.0, 'p_lng': 21.0}},
                       {'as': S, 'rpc': 'list_tutors', 'args': {'p_lat': 42.66, 'p_lng': 21.16, 'p_radius_km': 20}},
                       {'as': AGON, 'rpc': 'list_tutors'},
                       {'as': None, 'rpc': 'list_tutors'}]},
    {'name': 'individual lesson: book, accept, confirm, room, cancel',
     'steps': [SEQ] + SETUP + [BOOK,                                                          # 2
                       dict(MY, **{'as': S}), dict(MY, **{'as': T}),
                       {'as': S2, 'rpc': 'respond_lesson_request', 'args': {'p_lesson': '$3', 'p_student': '$user:' + S, 'p_accept': True}},
                       {'as': S, 'rpc': 'confirm_lesson_seat', 'args': {'p_lesson': '$3'}},
                       {'as': T, 'rpc': 'respond_lesson_request', 'args': {'p_lesson': '$3', 'p_student': '$user:' + S, 'p_accept': True}},
                       {'as': T, 'rpc': 'respond_lesson_request', 'args': {'p_lesson': '$3', 'p_student': '$user:' + S, 'p_accept': True}},
                       {'as': S, 'rpc': 'get_lesson_room', 'args': {'p_lesson': '$3'}},
                       {'as': S, 'rpc': 'confirm_lesson_seat', 'args': {'p_lesson': '$3'}, 'expect_diff': TICKET},
                       {'as': S, 'rpc': 'confirm_lesson_seat', 'args': {'p_lesson': '$3'}},
                       {'as': S, 'rpc': 'get_lesson_room', 'args': {'p_lesson': '$3'}},
                       {'as': S2, 'rpc': 'get_lesson_room', 'args': {'p_lesson': '$3'}},
                       {'sql': "update public.lessons set starts_at = starts_at - interval '3 days' + interval '10 minutes'"},
                       {'as': S, 'rpc': 'get_lesson_room', 'args': {'p_lesson': '$3'}, 'expect_diff': ROOM},
                       {'as': T, 'rpc': 'get_lesson_room', 'args': {'p_lesson': '$3'}, 'expect_diff': ROOM},
                       dict(MY, **{'as': S}), dict(MY, **{'as': T}),
                       # overlapping second booking by another student
                       {'as': S2, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_starts_at='$now+0d')},
                       {'sql': "update public.lessons set starts_at = starts_at - interval '2 hours 10 minutes'"},
                       {'as': S, 'rpc': 'get_lesson_room', 'args': {'p_lesson': '$3'}},
                       {'as': T, 'rpc': 'list_tutors'},
                       {'sql': "update public.lessons set starts_at = starts_at + interval '3 days 2 hours'"},
                       {'as': S2, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_starts_at='$now+3d')},
                       {'as': S2, 'rpc': 'cancel_lesson', 'args': {'p_lesson': '$3'}},
                       {'as': S, 'rpc': 'cancel_lesson', 'args': {'p_lesson': '$3'}},
                       {'as': S, 'rpc': 'cancel_lesson', 'args': {'p_lesson': '$3'}},
                       {'as': S, 'rpc': 'get_lesson_room', 'args': {'p_lesson': '$3'}},
                       {'as': S, 'rpc': 'confirm_lesson_seat', 'args': {'p_lesson': '$3'}},
                       dict(MY, **{'as': S})]},
    {'name': 'book_lesson errors + decline',
     'steps': [SEQ] + SETUP + [
         {'as': NEW, 'rpc': 'book_lesson', 'args': BOOK['args']},
         {'as': None, 'rpc': 'book_lesson', 'args': BOOK['args']},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_tutor='$user:' + S2)},
         {'as': T, 'rpc': 'book_lesson', 'args': BOOK['args']},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_subject='piano')},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_format='video')},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_starts_at='$now+0d')},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_starts_at='$now+100d')},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_duration=50)},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_note=None, p_duration=30)},   # 12
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_starts_at='$now+4d', p_duration=90)},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_starts_at='$now+5d')},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_starts_at='$now+6d')},
         {'as': T, 'rpc': 'respond_lesson_request', 'args': {'p_lesson': '$13', 'p_student': '$user:' + S, 'p_accept': False}},
         {'as': T, 'rpc': 'respond_lesson_request', 'args': {'p_lesson': '$13', 'p_student': '$user:' + S, 'p_accept': False}},
         {'as': T, 'rpc': 'respond_lesson_request', 'args': {'p_lesson': '$user:' + S, 'p_student': '$user:' + S, 'p_accept': True}},
         {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_starts_at='$now+6d')},
         {'as': T, 'rpc': 'cancel_lesson', 'args': {'p_lesson': '$14'}},
         {'as': S, 'rpc': 'cancel_lesson', 'args': {'p_lesson': '$user:' + S}},
         dict(MY, **{'as': S}), dict(MY, **{'as': T})]},
    {'name': 'blocked pair + unapproved tutor',
     'steps': [SEQ, apply(T2), {'as': AGON, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_tutor='$user:' + T2)},
               approve(T2),
               {'as': AGON, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_tutor='$user:' + T2)},
               {'as': T2, 'rpc': 'create_group_lesson', 'args': GROUP['args']},          # 4
               {'as': AGON, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$5'}},
               {'as': AGON, 'rpc': 'list_group_lessons'}]},
    {'name': 'group lessons: create, list, join, full, cancel',
     'steps': [SEQ] + SETUP + [
         {'as': S, 'rpc': 'create_group_lesson', 'args': GROUP['args']},
         {'as': NEW, 'rpc': 'create_group_lesson', 'args': GROUP['args']},
         {'as': T, 'rpc': 'create_group_lesson', 'args': dict(GROUP['args'], p_subject='piano')},
         {'as': T, 'rpc': 'create_group_lesson', 'args': dict(GROUP['args'], p_starts_at='$now+0d')},
         {'as': T, 'rpc': 'create_group_lesson', 'args': dict(GROUP['args'], p_max_students=1)},
         {'as': T, 'rpc': 'create_group_lesson', 'args': dict(GROUP['args'], p_format='in_person', p_location_note='  ')},
         {'as': T, 'rpc': 'create_group_lesson', 'args': dict(GROUP['args'], p_title='ab')},
         GROUP,                                                                                         # 9
         {'as': T, 'rpc': 'create_group_lesson', 'args': dict(GROUP['args'], p_subject='math', p_format='in_person',
                                                              p_location_note=' Kafe ', p_price_cents=-5, p_max_students=30)},
         {'as': S, 'rpc': 'list_group_lessons'},
         {'as': S, 'rpc': 'list_group_lessons', 'args': {'p_subject': 'math'}},
         {'as': S, 'rpc': 'list_group_lessons', 'args': {'p_category': 'tech'}},
         {'as': None, 'rpc': 'list_group_lessons'},
         {'as': T, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': NEW, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S2, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S3, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S, 'rpc': 'list_group_lessons'},
         {'as': S, 'rpc': 'confirm_lesson_seat', 'args': {'p_lesson': '$10'}, 'expect_diff': TICKET},
         {'as': S, 'rpc': 'cancel_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S3, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S2, 'rpc': 'cancel_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S, 'rpc': 'confirm_lesson_seat', 'args': {'p_lesson': '$10'}, 'expect_diff': 'ticket random; payment exists -> ON CONFLICT DO NOTHING'},
         dict(MY, **{'as': T}), {'as': 'admin', 'rpc': 'admin_list_tutors', 'args': {'p_status': 'approved'}},
         {'as': T, 'rpc': 'cancel_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$10'}},
         {'as': S, 'rpc': 'get_lesson_room', 'args': {'p_lesson': '$11'}},
         {'as': S, 'rpc': 'list_group_lessons'},
         dict(MY, **{'as': S}), dict(MY, **{'as': T}), {'as': None, 'rpc': 'my_lessons'}]},
    {'name': 'group without group_ok / format',
     'steps': [SEQ, apply(T, group_ok=False, in_person=False), approve(T),
               {'as': T, 'rpc': 'create_group_lesson', 'args': GROUP['args']},
               {'sql': "update public.tutors set group_ok = true"},
               {'as': T, 'rpc': 'create_group_lesson', 'args': dict(GROUP['args'], p_format='in_person', p_location_note='x')},
               {'as': S, 'rpc': 'book_lesson', 'args': dict(BOOK['args'], p_format='in_person')},
               {'as': S, 'rpc': 'join_group_lesson', 'args': {'p_lesson': '$user:' + S}},
               {'as': S, 'rpc': 'cancel_lesson', 'args': {'p_lesson': '$user:' + S}},
               {'as': S, 'rpc': 'confirm_lesson_seat', 'args': {'p_lesson': '$user:' + S}},
               {'as': S, 'rpc': 'get_lesson_room', 'args': {'p_lesson': '$user:' + S}}]},
]
