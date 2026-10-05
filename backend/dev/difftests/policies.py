"""Direct table queries: the former RLS policies and triggers."""
ANA = 'ana.petrovska@gmail.com'          # Prishtinë, Basic
AGON = 'agon.begolli@gmail.com'          # Ferizaj, Basic
RINA = 'rina.halili@gmail.com'           # Pejë
TABLE_SELECT = ('*, host:profiles!tables_host_id_fkey (id, first_name, last_name, age, photo_path, verified, rating, tables_hosted),'
                ' memberships ( user_id, role, profile:profiles!memberships_user_id_fkey ( id, first_name, last_name, age, photo_path ) ),'
                ' requests ( id, user_id, status, profile:profiles!requests_user_id_fkey ( id, first_name ) ), waitlist ( user_id )')


def q(table, action='select', **kw):
    d = {'table': table, 'action': action}
    d.update(kw)
    return d


NEW_TABLE = {'kind': 'tavoline', 'category': 'food', 'title': 'Test darka', 'city': 'Prishtinë',
             'time_label': '20:00', 'spots': 4, 'event_datetime': '$now+3d'}

CASES = [
    {'name': 'listTables with embeds (basic user, own city)', 'unordered': True,
     'steps': [{'as': ANA, 'query': q('tables', select=TABLE_SELECT,
                                      filters=[{'col': 'status', 'op': 'eq', 'value': 'open'}],
                                      order=[{'col': 'event_datetime', 'ascending': True}])}]},
    {'name': 'tables visible per user', 'unordered': True,
     'steps': [{'as': w, 'query': q('tables', select='id,title,city')} for w in (ANA, AGON, RINA, 'admin')]
     + [{'as': None, 'query': q('tables', select='id')}]},
    {'name': 'count + head + range + filters',
     'steps': [{'as': 'admin', 'query': q('tables', select='id', count='exact', head=True)},
               {'as': 'admin', 'query': q('tables', select='id,title', order=[{'col': 'created_at', 'ascending': False}, {'col': 'id'}], limit=3, offset=2)},
               {'as': 'admin', 'query': q('tables', select='id', filters=[{'or': 'city.eq.Pejë,and(city.eq.Ferizaj,spots.gte.4)'}], order=[{'col': 'id'}])},
               {'as': 'admin', 'query': q('tables', select='id', filters=[{'col': 'title', 'op': 'ilike', 'value': '*bak*'}], order=[{'col': 'id'}])},
               {'as': 'admin', 'query': q('tables', select='id', filters=[{'col': 'kind', 'op': 'in', 'value': '(vozitje,udhetim)'}], order=[{'col': 'id'}])},
               {'as': 'admin', 'query': q('tables', select='id', filters=[{'col': 'to_city', 'op': 'is', 'value': 'null'}, {'col': 'women_only', 'op': 'eq', 'value': 'true'}], order=[{'col': 'id'}])},
               {'as': 'admin', 'query': q('tables', select='id', filters=[{'col': 'city', 'op': 'neq', 'value': 'Prishtinë', 'negate': True}], order=[{'col': 'id'}])},
               {'as': 'admin', 'query': q('profiles', select='id', filters=[{'col': 'langs', 'op': 'cs', 'value': '{Shqip}'}], order=[{'col': 'id'}])},
               {'as': 'admin', 'query': q('tables', select='id', single=True)},
               {'as': 'admin', 'query': q('tables', select='id', filters=[{'col': 'id', 'op': 'eq', 'value': 'x'}])},
               {'as': 'admin', 'query': q('tables', select='nope')},
               {'as': 'admin', 'query': q('nope')}]},
    {'name': 'create table (hooks: host membership, hosted count, plan city)',
     'steps': [{'as': ANA, 'query': q('tables', 'insert', values=dict(NEW_TABLE, host_id='$user:' + ANA), returning=True, single=True,
                                      select='*, host:profiles!tables_host_id_fkey(id, tables_hosted), memberships(user_id, role)')},
               {'as': ANA, 'query': q('tables', 'insert', values=dict(NEW_TABLE, city='Pejë', host_id='$user:' + ANA), returning=True)},
               {'as': ANA, 'query': q('tables', 'insert', values=dict(NEW_TABLE, host_id='$user:' + AGON))},
               {'as': ANA, 'query': q('tables', 'insert', values=dict(NEW_TABLE, event_datetime='$now-1d', host_id='$user:' + ANA))},
               {'as': None, 'query': q('tables', 'insert', values=NEW_TABLE),
                'expect_diff': 'SQL failed on the share-code default (permission denied for function); now a plain RLS refusal'}]},
]


def uid(email):
    return '$user:' + email


def sql1(q):
    return '$sql:' + q


FATOS = 'fatos.jashari@gmail.com'      # has an approved request
ARTA = 'arta.krasniqi@gmail.com'       # has pending requests
NORA = 'nora.rama@gmail.com'           # member of several tables
SARA = 'sara.gjoka@gmail.com'
REQ_APPROVED = sql1("select r.id from requests r join auth.users u on u.id = r.user_id"
                    " where u.email = 'fatos.jashari@gmail.com' and r.status = 'approved' limit 1")
REQ_PENDING = sql1("select r.id from requests r join auth.users u on u.id = r.user_id"
                   " where u.email = 'arta.krasniqi@gmail.com' and r.status = 'pending' order by r.id limit 1")
NORA_TABLE = sql1("select m.table_id from memberships m join auth.users u on u.id = m.user_id"
                  " where u.email = 'nora.rama@gmail.com' and m.role = 'member' order by m.table_id limit 1")
NORA_FUTURE_OPEN = sql1("select t.id from tables t where t.status = 'open' and t.event_datetime > now()"
                        " and t.city = 'Prishtinë' and not exists (select 1 from memberships m join auth.users u"
                        " on u.id = m.user_id where m.table_id = t.id and u.email = 'nora.rama@gmail.com')"
                        " order by t.id limit 1")
HOST_OF_NORA_TABLE = sql1("select u.email from tables t join auth.users u on u.id = t.host_id where t.id = ("
                          "select m.table_id from memberships m join auth.users u2 on u2.id = m.user_id"
                          " where u2.email = 'nora.rama@gmail.com' and m.role = 'member' order by m.table_id limit 1)")

ALL_TABLES = ['admin_audit_log', 'affinity', 'badges', 'bans', 'blocks', 'connection_picks', 'connections',
              'lesson_participants', 'lesson_rooms', 'lesson_subjects', 'lessons', 'memberships', 'messages',
              'notification_badge_labels', 'notification_text_rules', 'notifications', 'payments', 'plans',
              'profiles', 'ratings', 'reports', 'requests', 'subscription_orders', 'subscriptions', 'tables',
              'taste_profiles', 'tutors', 'waitlist', 'wednesday_groups', 'wednesday_participants',
              'wednesday_restaurants', 'wednesday_signups']

CASES += [
    {'name': f'read rules: {t}', 'unordered': True,
     'steps': [{'as': who, 'query': q(t, select='*', count='exact')} for who in ('admin', NORA, ARTA, None)]}
    for t in ALL_TABLES
] + [
    {'name': 'profiles: own updates, others, reactivation, onboarded_at kept',
     'steps': [{'as': NORA, 'query': q('profiles', 'update', values={'age': 33, 'photo_path': f'x/p.jpg',
                                                                       'user_preferences': {'lang': 'en'}},
                                       filters=[{'col': 'id', 'op': 'eq', 'value': uid(NORA)}], returning=True)},
               {'as': NORA, 'query': q('profiles', 'update', values={'age': 40},
                                       filters=[{'col': 'id', 'op': 'eq', 'value': uid(SARA)}], returning=True)},
               {'as': NORA, 'query': q('profiles', 'update', values={'age': 17},
                                       filters=[{'col': 'id', 'op': 'eq', 'value': uid(NORA)}])},
               {'as': NORA, 'query': q('profiles', 'update', values={'onboarded_at': None},
                                       filters=[{'col': 'id', 'op': 'eq', 'value': uid(NORA)}], returning=True,
                                       select='id,onboarded_at')},
               {'as': NORA, 'query': q('profiles', 'update', values={'deactivated_at': '$now+0d'},
                                       filters=[{'col': 'id', 'op': 'eq', 'value': uid(NORA)}])},
               {'as': NORA, 'query': q('profiles', 'update', values={'deactivated_at': None},
                                       filters=[{'col': 'id', 'op': 'eq', 'value': uid(NORA)}])},
               {'as': 'admin', 'query': q('profiles', 'update', values={'deactivated_at': None},
                                          filters=[{'col': 'id', 'op': 'eq', 'value': uid(NORA)}], returning=True,
                                          select='id,deactivated_at')}]},
    {'name': 'notifications: mark read (own only)',
     'steps': [{'as': NORA, 'query': q('notifications', 'update', values={'read': True},
                                       filters=[{'col': 'user_id', 'op': 'eq', 'value': uid(NORA)}], count='exact')},
               {'as': NORA, 'query': q('notifications', 'update', values={'read': True},
                                       filters=[{'col': 'user_id', 'op': 'eq', 'value': uid(SARA)}], count='exact')},
               {'as': NORA, 'query': q('notifications', 'update', values={'user_id': uid(SARA)},
                                       filters=[{'col': 'user_id', 'op': 'eq', 'value': uid(NORA)}])}]},
    {'name': 'requests: confirm own approved seat; host sees requests; others do not',
     'steps': [{'as': FATOS, 'query': q('requests', 'update', values={'status': 'confirmed'},
                                        filters=[{'col': 'id', 'op': 'eq', 'value': REQ_APPROVED}], returning=True)},
               {'as': ARTA, 'query': q('requests', 'update', values={'status': 'confirmed'},
                                       filters=[{'col': 'id', 'op': 'eq', 'value': REQ_APPROVED}], returning=True)},
               {'as': ARTA, 'query': q('requests', 'select', select='id,status',
                                       filters=[{'col': 'id', 'op': 'eq', 'value': REQ_APPROVED}])}]},
    # Intentional change: the old policy let people set any status on their own request.
    {'name': 'requests: self-approval now refused (intentional)', 'ignore_tables': ('requests', 'notifications', 'tables'),
     'steps': [{'as': ARTA, 'query': q('requests', 'update', values={'status': 'approved'},
                                       filters=[{'col': 'id', 'op': 'eq', 'value': REQ_PENDING}]),
                'expect_diff': 'self-approval now refused (RLS error) instead of allowed'}]},
    {'name': 'requests insert: direct join request (plan, onboarding, block rules)',
     'steps': [{'as': NORA, 'query': q('requests', 'insert', values={'table_id': NORA_FUTURE_OPEN, 'user_id': uid(NORA)},
                                       returning=True, select='id,status,table_id,user_id')},
               {'as': NORA, 'query': q('requests', 'insert', values={'table_id': NORA_FUTURE_OPEN, 'user_id': uid(NORA)})},
               {'as': NORA, 'query': q('requests', 'insert', values={'table_id': NORA_FUTURE_OPEN, 'user_id': uid(SARA)})},
               {'as': 'agon.begolli@gmail.com', 'query': q('requests', 'insert', values={
                   'table_id': NORA_FUTURE_OPEN, 'user_id': uid('agon.begolli@gmail.com')})}]},
    {'name': 'waitlist: join, leave; memberships delete promotes the first waiting',
     'steps': [{'as': NORA, 'query': q('waitlist', 'insert', values={'table_id': NORA_FUTURE_OPEN, 'user_id': uid(NORA)},
                                       returning=True)},
               {'as': SARA, 'query': q('waitlist', 'insert', values={'table_id': NORA_FUTURE_OPEN, 'user_id': uid(SARA)})},
               {'as': SARA, 'query': q('waitlist', 'delete', filters=[{'col': 'user_id', 'op': 'eq', 'value': uid(SARA)}],
                                       returning=True)},
               {'as': sql1("select u.email from memberships m join auth.users u on u.id = m.user_id where m.role = 'member'"
                           " and m.table_id = (select w.table_id from waitlist w limit 1) order by u.email limit 1"),
                'rpc': 'leave_table', 'args': {'p_table': sql1("select table_id from waitlist limit 1")}}]},
    {'name': 'messages and ratings (members only); rating updates host + affinity',
     'steps': [{'as': NORA, 'query': q('messages', 'insert', values={'table_id': NORA_TABLE, 'sender_id': uid(NORA), 'body': 'Ckemi!'},
                                       returning=True, select='table_id,sender_id,body')},
               {'as': ARTA, 'query': q('messages', 'insert', values={'table_id': NORA_TABLE, 'sender_id': uid(ARTA), 'body': 'hi'})},
               {'as': NORA, 'query': q('ratings', 'insert', values={'table_id': NORA_TABLE, 'rater_id': uid(NORA), 'stars': 5},
                                       returning=True)},
               {'as': NORA, 'query': q('ratings', 'insert', values={'table_id': NORA_TABLE, 'rater_id': uid(NORA), 'stars': 1})},
               {'as': ARTA, 'query': q('ratings', 'insert', values={'table_id': NORA_TABLE, 'rater_id': uid(ARTA), 'stars': 1})},
               {'as': NORA, 'query': q('affinity', 'select')}]},
    {'name': 'connection picks: mutual pick connects and notifies',
     'steps': [{'as': NORA, 'query': q('connection_picks', 'insert', values={
                   'table_id': NORA_TABLE, 'picker_id': uid(NORA), 'picked_id': sql1(
                       "select t.host_id from tables t where t.id = (select m.table_id from memberships m join auth.users u"
                       " on u.id = m.user_id where u.email = 'nora.rama@gmail.com' and m.role = 'member' order by m.table_id limit 1)")})},
               {'as': HOST_OF_NORA_TABLE, 'query': q('connection_picks', 'insert', values={
                   'table_id': NORA_TABLE, 'picker_id': sql1(
                       "select t.host_id from tables t where t.id = (select m.table_id from memberships m join auth.users u"
                       " on u.id = m.user_id where u.email = 'nora.rama@gmail.com' and m.role = 'member' order by m.table_id limit 1)"),
                   'picked_id': uid(NORA)})},
               {'as': NORA, 'query': q('connections', 'select', select='a,b')},
               {'as': ARTA, 'query': q('connection_picks', 'insert', values={'table_id': NORA_TABLE, 'picker_id': uid(ARTA),
                                                                             'picked_id': uid(NORA)})}]},
    {'name': 'blocks, reports, badges, payments',
     'steps': [{'as': NORA, 'query': q('blocks', 'insert', values={'blocker_id': uid(NORA), 'blocked_id': uid(SARA)}, returning=True)},
               {'as': NORA, 'query': q('blocks', 'insert', values={'blocker_id': uid(SARA), 'blocked_id': uid(NORA)})},
               {'as': SARA, 'query': q('blocks', 'select', select='blocker_id,blocked_id')},
               {'as': SARA, 'query': q('blocks', 'delete', filters=[{'col': 'blocked_id', 'op': 'eq', 'value': uid(SARA)}], count='exact')},
               {'as': NORA, 'query': q('blocks', 'delete', filters=[{'col': 'blocked_id', 'op': 'eq', 'value': uid(SARA)}], count='exact')},
               {'as': NORA, 'query': q('reports', 'insert', values={'reporter_id': uid(NORA), 'reported_id': uid(SARA), 'reason': 'Spam'},
                                       returning=True, select='reporter_id,reported_id,reason,status')},
               {'as': NORA, 'query': q('reports', 'update', values={'status': 'reviewed_dismissed'},
                                       filters=[{'col': 'reporter_id', 'op': 'eq', 'value': uid(NORA)}], count='exact')},
               {'as': 'admin', 'query': q('reports', 'update', values={'status': 'reviewed_dismissed'},
                                          filters=[{'col': 'reporter_id', 'op': 'eq', 'value': uid(NORA)}], count='exact')},
               {'as': NORA, 'query': q('badges', 'insert', values={'user_id': uid(NORA), 'badge_id': 'first-join'})},
               {'as': NORA, 'query': q('badges', 'insert', values={'user_id': uid(SARA), 'badge_id': 'first-join'})},
               {'as': NORA, 'query': q('payments', 'insert', values={'user_id': uid(NORA), 'table_id': NORA_TABLE, 'amount_cents': 200,
                                                                     'provider': 'stub', 'provider_ref': 'S-1', 'ticket_code': 'EBK-9'},
                                       returning=True, select='user_id,payer_name,table_title,amount_cents')},
               {'as': NORA, 'query': q('payments', 'insert', values={'user_id': uid(NORA), 'table_id': NORA_TABLE, 'amount_cents': 0,
                                                                     'provider': 'manual', 'provider_ref': 'S-2', 'ticket_code': 'EBK-8'})}]},
    {'name': 'taste profile upsert; affinity write refused',
     'steps': [{'as': NORA, 'query': q('taste_profiles', 'upsert', onConflict='user_id', returning=True, maybeSingle=True,
                                       values={'user_id': uid(NORA), 'energy': 'calm', 'interests': ['books'], 'done': True})},
               {'as': NORA, 'query': q('taste_profiles', 'upsert', onConflict='user_id', returning=True, maybeSingle=True,
                                       values={'user_id': uid(NORA), 'energy': 'lively', 'interests': [], 'done': True})},
               {'as': NORA, 'query': q('affinity', 'upsert', onConflict='user_id,category',
                                       values=[{'user_id': uid(NORA), 'category': 'kafe', 'score': 3}])}]},
    {'name': 'tutors: apply (forced pending), edit, cannot self-approve',
     'steps': [{'as': NORA, 'query': q('tutors', 'insert', values={
                   'user_id': uid(NORA), 'headline': 'Mësuese anglishteje', 'bio': 'x' * 40, 'subjects': ['english', 'math', 'english'],
                   'price_cents': 1000, 'city': 'Prishtinë', 'online': True, 'status': 'approved', 'lat': 42.66289, 'lng': 21.16543})},
               {'as': NORA, 'query': q('tutors', 'update', values={'status': 'approved', 'price_cents': 1200},
                                       filters=[{'col': 'user_id', 'op': 'eq', 'value': uid(NORA)}], returning=True,
                                       select='user_id,status,price_cents,subjects,lat,lng')},
               {'as': ARTA, 'query': q('tutors', 'select', select='user_id')},
               {'as': NORA, 'query': q('tutors', 'insert', values={
                   'user_id': uid(SARA), 'headline': 'Hello there', 'bio': 'y' * 40, 'subjects': ['math'],
                   'price_cents': 1000, 'city': 'Prishtinë', 'online': True})},
               {'as': NORA, 'query': q('tutors', 'update', values={'subjects': ['klingon']},
                                       filters=[{'col': 'user_id', 'op': 'eq', 'value': uid(NORA)}])},
               {'as': NORA, 'query': q('tutors', 'delete', filters=[{'col': 'user_id', 'op': 'eq', 'value': uid(NORA)}], count='exact')}]},
    {'name': 'tables: host edits / closes / deletes; share code kept; others cannot',
     'steps': [{'as': ANA, 'query': q('tables', 'insert', values=dict(NEW_TABLE, host_id=uid(ANA)), returning=True, single=True,
                                      select='id,share_code')},
               {'as': ANA, 'query': q('tables', 'update', values={'title': 'Darka e re', 'share_code': 'zzzzzzzz'},
                                      filters=[{'col': 'id', 'op': 'eq', 'value': '$0.data.id'}], returning=True, single=True,
                                      select='id,title,share_code')},
               {'as': AGON, 'query': q('tables', 'update', values={'title': 'hack'},
                                       filters=[{'col': 'id', 'op': 'eq', 'value': '$0.data.id'}], count='exact')},
               {'as': ANA, 'query': q('tables', 'update', values={'host_id': uid(AGON)},
                                      filters=[{'col': 'id', 'op': 'eq', 'value': '$0.data.id'}])},
               {'as': ANA, 'query': q('tables', 'update', values={'status': 'cancelled'},
                                      filters=[{'col': 'id', 'op': 'eq', 'value': '$0.data.id'}, {'col': 'host_id', 'op': 'eq', 'value': uid(ANA)}])},
               {'as': AGON, 'query': q('tables', 'delete', filters=[{'col': 'id', 'op': 'eq', 'value': '$0.data.id'}], count='exact')},
               {'as': ANA, 'query': q('tables', 'delete', filters=[{'col': 'id', 'op': 'eq', 'value': '$0.data.id'}], count='exact')}]},
]
