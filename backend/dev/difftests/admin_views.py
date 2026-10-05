"""Group E: admin read-only views."""
USER = 'agon.begolli@gmail.com'
MIA = 'mia.fischer@gmail.com'

# extra state: bans, audit rows, a report with a table, a non-paid payment, a deactivated user
SETUP = [
    {'sql': "insert into public.bans (user_id, reason, created_at) select id, 'spam', date_trunc('hour', now()) - interval '3 days' "
            "from auth.users where email = 'mia.fischer@gmail.com'"},
    {'sql': "insert into public.bans (user_id, reason, created_at) select id, 'abuse', date_trunc('hour', now()) - interval '1 day' "
            "from auth.users where email = 'mia.fischer@gmail.com'"},
    {'sql': "insert into public.bans (user_id, reason, created_at) select id, 'fake', date_trunc('hour', now()) - interval '2 days' "
            "from auth.users where email = 'gresa.leka@gmail.com'"},
    {'sql': "insert into public.admin_audit_log (id, admin_id, admin_name, action, target_type, target_id, target_label, details, created_at) "
            "select 900000 + g, (select id from auth.users where email='support@ejabashkohu.com'), 'Support', 'act' || g, "
            "case when g % 2 = 0 then 'user' else 'table' end, "
            "case when g % 2 = 0 then (select id from auth.users where email='mia.fischer@gmail.com') "
            "else (select id from public.tables where title like 'Baklori%' limit 1) end, 'x', "
            "jsonb_build_object('n', g), date_trunc('hour', now()) - make_interval(hours => g) from generate_series(1, 7) g"},
    # The seed data has many equal timestamps (payments, requests, memberships created in one
    # transaction) and tied counts per city; the SQL order of ties is undefined, so make them distinct.
    {'sql': "update public.payments p set created_at = p.created_at - make_interval(secs => x.rn) "
            "from (select id, row_number() over (order by id) rn from public.payments) x where x.id = p.id"},
    {'sql': "update public.requests p set created_at = p.created_at - make_interval(secs => x.rn) "
            "from (select id, row_number() over (order by id) rn from public.requests) x where x.id = p.id"},
    {'sql': "update public.memberships p set joined_at = p.joined_at - make_interval(secs => x.rn) "
            "from (select table_id, user_id, row_number() over (order by table_id, user_id) rn from public.memberships) x "
            "where x.table_id = p.table_id and x.user_id = p.user_id"},
    {'sql': "update public.tables set city = 'Pejë' where id in (select id from public.tables where city = 'Ferizaj' order by id limit 3)"},
    {'sql': "update public.tables set city = 'Prishtinë' where id in (select id from public.tables where city = 'Gjakovë' order by id limit 1)"},
    {'sql': "update public.profiles set deactivated_at = date_trunc('hour', now()) - interval '1 hour' "
            "where id = (select id from auth.users where email = 'erion.morina@gmail.com')"},
    {'sql': "update public.payments set status = 'void' where ticket_code = 'EBK-1072'"},
    {'sql': "update public.reports set table_id = (select id from public.tables where title like 'Baklori%' limit 1) "
            "where id = (select id from public.reports order by created_at limit 1)"},
]


def adm(rpc, **args):
    return {'as': 'admin', 'rpc': rpc, 'args': args}


def perms(rpc, **args):
    return {'name': f'{rpc} permissions',
            'steps': [{'as': USER, 'rpc': rpc, 'args': args}, {'as': None, 'rpc': rpc, 'args': args}]}


CASES = [perms(n) for n in ('admin_get_dashboard', 'admin_get_stats', 'admin_get_reports', 'admin_list_audit',
                            'admin_list_bans', 'admin_list_payments', 'admin_list_reports', 'admin_list_tables',
                            'admin_list_users', 'admin_get_http_responses')] + [
    perms('admin_get_table', p_table='$tbl:Baklori'),
    perms('admin_get_user', p_user='$user:' + MIA),
    perms('admin_global_search', p_q='ag'),

    {'name': 'admin_get_dashboard ranges',
     'steps': SETUP + [adm('admin_get_dashboard'), adm('admin_get_dashboard', p_range='day'),
                       adm('admin_get_dashboard', p_range='year'), adm('admin_get_dashboard', p_range='bogus'),
                       adm('admin_get_dashboard', p_range=None)]},
    {'name': 'admin_get_stats ranges',
     'steps': SETUP + [adm('admin_get_stats'), adm('admin_get_stats', p_range='day'),
                       adm('admin_get_stats', p_range='year'), adm('admin_get_stats', p_range='xx'),
                       adm('admin_get_stats', p_range=None)]},
    {'name': 'admin_get_http_responses',
     'steps': [adm('admin_get_http_responses'), adm('admin_get_http_responses', p_limit=100),
               adm('admin_get_http_responses', p_limit=None)]},
    {'name': 'admin_get_reports / admin_list_reports statuses',
     'steps': SETUP + [adm('admin_get_reports'), adm('admin_get_reports', p_status='reviewed_banned'),
                       adm('admin_get_reports', p_status=None), adm('admin_list_reports'),
                       adm('admin_list_reports', p_status='all'), adm('admin_list_reports', p_status=None),
                       adm('admin_list_reports', p_status='reviewed_dismissed'),
                       adm('admin_list_reports', p_status='nope')]},
    {'name': 'admin_get_table',
     'steps': SETUP + [adm('admin_get_table', p_table='$tbl:Baklori'), adm('admin_get_table', p_table='$tbl:Liburnia'),
                       adm('admin_get_table', p_table='$tbl:Te Komiteti'),
                       adm('admin_get_table', p_table='00000000-0000-0000-0000-000000000000'),
                       adm('admin_get_table', p_table='bad'), adm('admin_get_table', p_table=None)]},
    {'name': 'admin_get_user',
     'steps': SETUP + [adm('admin_get_user', p_user='$user:' + MIA), adm('admin_get_user', p_user='$user:admin'),
                       adm('admin_get_user', p_user='$user:' + USER),
                       adm('admin_get_user', p_user='$user:erion.morina@gmail.com'),
                       adm('admin_get_user', p_user='00000000-0000-0000-0000-000000000000'),
                       adm('admin_get_user', p_user=None)]},
    {'name': 'admin_global_search',
     'steps': SETUP + [adm('admin_global_search', p_q=x) for x in
                       (None, '', ' a ', 'ag', 'AGON', 'gmail', 'Prishtin', 'EBK-107', 'stub', 'a_o', 'zzzz%',
                        '%', 'Baklori')]
     + [adm('admin_global_search', p_q='$user:' + MIA), adm('admin_global_search', p_q='$tbl:Liburnia')]},
    {'name': 'admin_list_audit paging',
     'steps': SETUP + [adm('admin_list_audit'), adm('admin_list_audit', p_limit=3, p_offset=2),
                       adm('admin_list_audit', p_limit=0, p_offset=-5), adm('admin_list_audit', p_limit=None, p_offset=None),
                       adm('admin_list_audit', p_limit=1000, p_offset=6), adm('admin_list_audit', p_offset=100)]},
    {'name': 'admin_list_bans',
     'steps': [adm('admin_list_bans')] + SETUP + [adm('admin_list_bans')]},
    {'name': 'admin_list_payments filters',
     'steps': SETUP + [adm('admin_list_payments', p_search=x) for x in
                       ('EBK-1001', 'ebk', 'Agon', 'gmail.com', 'Liburnia', 'STUB-', '  ', 'zz_')]
     + [adm('admin_list_payments', p_status='paid', p_limit=5), adm('admin_list_payments', p_status='void'),
        adm('admin_list_payments', p_status=' '), adm('admin_list_payments', p_provider='stub', p_limit=3, p_offset=1),
        adm('admin_list_payments', p_provider='stripe'),
        adm('admin_list_payments', p_from='$now-1d', p_to='$now+1d'),
        adm('admin_list_payments', p_from='2020-01-01', p_to='2020-02-01'),
        adm('admin_list_payments', p_search='$user:' + USER),
        adm('admin_list_payments', p_search='$tbl:Liburnia')]},
    {'name': 'admin_list_tables filters',
     'steps': SETUP + [adm('admin_list_tables', p_status=s) for s in
                       ('all', 'upcoming', 'past', 'full', 'cancelled', 'reported', 'paid', 'weird', None)]
     + [adm('admin_list_tables', p_search=x) for x in ('prishtin', 'Agon', 'Bak', '$user:' + USER, '$tbl:Liburnia', ' ')]
     + [adm('admin_list_tables', p_kind='vozitje'), adm('admin_list_tables', p_city='Pejë'),
        adm('admin_list_tables', p_kind=' ', p_city=' '),
        adm('admin_list_tables', p_limit=500, p_offset=-1), adm('admin_list_tables', p_limit=3, p_offset=4)]},
    {'name': 'admin_list_tables sorts',
     'steps': SETUP + [adm('admin_list_tables', p_sort=s, p_limit=100) for s in
                       ('newest', 'oldest', 'event_asc', 'event_desc', 'most_guests', 'most_revenue',
                        'most_requests', 'x', None)]},
    {'name': 'admin_list_users filters',
     'steps': SETUP + [adm('admin_list_users', p_status=s, p_limit=100) for s in
                       ('all', 'active', 'deactivated', 'admin', 'banned', 'reported', 'unconfirmed', 'paying',
                        'hosts', 'x', None)]
     + [adm('admin_list_users', p_search=x) for x in ('agon', 'GMAIL', 'Mia F', '$user:' + MIA, '%', ' ')]
     + [adm('admin_list_users', p_limit=0, p_offset=3), adm('admin_list_users', p_limit=5, p_offset=40)]},
    {'name': 'admin_list_users sorts',
     'steps': SETUP + [adm('admin_list_users', p_sort=s, p_limit=100) for s in
                       ('newest', 'oldest', 'name', 'last_active', 'most_hosted', 'most_joined', 'most_paid',
                        'most_reported', 'x', None)]},
]
