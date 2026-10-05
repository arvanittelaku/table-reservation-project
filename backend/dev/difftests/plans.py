U = 'agon.begolli@gmail.com'
U2 = 'emma.schmidt@gmail.com'
A = 'admin'
SUB = ("insert into public.subscriptions (user_id, plan_id, starts_at, ends_at, source, amount_cents, created_at) "
       "select id, 'premium_1m', date_trunc('day', now()) - interval '{a} days', date_trunc('day', now()) + interval '{b} days', 'admin_grant', {c}, date_trunc('day', now()) - interval '{a} days' "
       "from auth.users where email = '{e}'")

# ends_at = now() + n months differs between the two runs by a few ms (now() is not
# the same instant); truncate fresh ones to the minute so both sides compare.
TRUNC = {'sql': "update public.subscriptions set ends_at = date_trunc('minute', ends_at) "
                "where created_at > now() - interval '1 minute' and ends_at - starts_at < interval '13 months' "
                "and extract(second from ends_at) <> 0; "
                "update public.notifications set params = jsonb_set(params, '{at}', "
                "to_jsonb(date_trunc('minute', (params->>'at')::timestamptz))) "
                "where kind = 'premiumActivated' and created_at > now() - interval '1 minute'"}

CASES = [
    {'name': 'my_plan basic / signed out / admin',
     'steps': [{'as': U, 'rpc': 'my_plan'}, {'as': None, 'rpc': 'my_plan'}, {'as': A, 'rpc': 'my_plan'}]},
    {'name': 'request_premium, replace order, my_plan pending, cancel',
     'steps': [{'as': U, 'rpc': 'request_premium', 'args': {'p_plan': 'premium_1m'}},
               {'as': U, 'rpc': 'request_premium', 'args': {'p_plan': 'premium_3m'}},
               {'as': U, 'rpc': 'my_plan'},
               {'as': U, 'rpc': 'cancel_premium_order'},
               {'as': U, 'rpc': 'my_plan'},
               {'as': None, 'rpc': 'cancel_premium_order'}]},
    {'name': 'request_premium errors',
     'steps': [{'as': U, 'rpc': 'request_premium', 'args': {'p_plan': 'basic'}},
               {'as': U, 'rpc': 'request_premium', 'args': {'p_plan': 'nope'}},
               {'sql': "update public.plans set active = false where id = 'premium_12m'"},
               {'as': U, 'rpc': 'request_premium', 'args': {'p_plan': 'premium_12m'}},
               {'as': None, 'rpc': 'request_premium', 'args': {'p_plan': 'premium_1m'}}]},
    {'name': 'admin_mark_order_paid happy + twice + non-admin',
     'steps': [{'as': U, 'rpc': 'request_premium', 'args': {'p_plan': 'premium_3m'}},
               {'as': U2, 'rpc': 'admin_mark_order_paid', 'args': {'p_order': '$0.id'}},
               {'as': A, 'rpc': 'admin_mark_order_paid', 'args': {'p_order': '$0.id'}},
               {'as': A, 'rpc': 'admin_mark_order_paid', 'args': {'p_order': '$0.id'}},
               TRUNC,
               {'as': U, 'rpc': 'my_plan'},
               {'as': A, 'rpc': 'admin_plans_overview'}]},
    {'name': 'admin_cancel_order',
     'steps': [{'as': U, 'rpc': 'request_premium', 'args': {'p_plan': 'premium_1m'}},
               {'as': U, 'rpc': 'admin_cancel_order', 'args': {'p_order': '$0.id'}},
               {'as': A, 'rpc': 'admin_cancel_order', 'args': {'p_order': '$0.id'}},
               {'as': A, 'rpc': 'admin_cancel_order', 'args': {'p_order': '$0.id'}},
               {'as': None, 'rpc': 'admin_cancel_order', 'args': {'p_order': '$0.id'}}]},
    {'name': 'admin_grant_premium stacks on existing premium (month arithmetic)',
     'steps': [{'sql': SUB.format(a=10, b=21, c=999, e=U)},
               {'as': A, 'rpc': 'admin_grant_premium', 'args': {'p_user': '$user:' + U, 'p_plan': 'premium_12m', 'p_note': '  gift '}},
               {'as': A, 'rpc': 'admin_grant_premium', 'args': {'p_user': '$user:' + U2, 'p_plan': 'premium_1m'}},
               TRUNC,
               # (admin_plans_overview not compared here: both grants share created_at = now(),
               #  and the SQL order of ties is undefined)
               {'as': U, 'rpc': 'my_plan'},
               {'as': U2, 'rpc': 'my_plan'}]},
    {'name': 'month end clamping (Jan 31 + 1 month)',
     'steps': [{'sql': "insert into public.subscriptions (user_id, plan_id, starts_at, ends_at, source) "
                       "select id, 'premium_1m', now(), '2027-01-31 10:00:00+00', 'admin_grant' from auth.users where email = 'agon.begolli@gmail.com'"},
               {'as': A, 'rpc': 'admin_grant_premium', 'args': {'p_user': '$user:' + U, 'p_plan': 'premium_1m', 'p_note': ''}},
               {'as': A, 'rpc': 'admin_grant_premium', 'args': {'p_user': '$user:' + U, 'p_plan': 'premium_3m'}}]},
    {'name': 'admin_grant_premium errors',
     'steps': [{'as': A, 'rpc': 'admin_grant_premium', 'args': {'p_user': '$user:' + U, 'p_plan': 'basic'}},
               {'as': A, 'rpc': 'admin_grant_premium', 'args': {'p_user': '00000000-0000-0000-0000-000000000001', 'p_plan': 'premium_1m'}},
               {'as': U, 'rpc': 'admin_grant_premium', 'args': {'p_user': '$user:' + U, 'p_plan': 'premium_1m'}},
               {'as': None, 'rpc': 'admin_grant_premium', 'args': {'p_user': '$user:' + U, 'p_plan': 'premium_1m'}}]},
    {'name': 'admin_revoke_premium',
     'steps': [{'sql': SUB.format(a=10, b=21, c=999, e=U)},
               {'sql': SUB.format(a=1, b=5, c=0, e=U)},
               {'as': A, 'rpc': 'admin_revoke_premium', 'args': {'p_user': '$user:' + U, 'p_reason': '  '}},
               {'as': U, 'rpc': 'admin_revoke_premium', 'args': {'p_user': '$user:' + U, 'p_reason': 'x'}},
               {'as': A, 'rpc': 'admin_revoke_premium', 'args': {'p_user': '$user:' + U, 'p_reason': ' abuse '}},
               {'as': A, 'rpc': 'admin_revoke_premium', 'args': {'p_user': '$user:' + U, 'p_reason': 'again'}},
               {'as': U, 'rpc': 'my_plan'}]},
    {'name': 'admin_update_plan basic/premium/errors',
     'steps': [{'as': A, 'rpc': 'admin_update_plan', 'args': {'p_plan': 'basic', 'p_price_cents': 500, 'p_table_limit': 5, 'p_join_limit': 10, 'p_active': False}},
               {'as': A, 'rpc': 'admin_update_plan', 'args': {'p_plan': 'premium_1m', 'p_price_cents': -5, 'p_table_limit': 5, 'p_join_limit': 10, 'p_active': None}},
               {'as': A, 'rpc': 'admin_update_plan', 'args': {'p_plan': 'premium_3m', 'p_price_cents': None, 'p_table_limit': None, 'p_join_limit': None, 'p_active': False}},
               {'as': A, 'rpc': 'admin_update_plan', 'args': {'p_plan': 'nope', 'p_price_cents': 1, 'p_table_limit': 1, 'p_join_limit': 1, 'p_active': True}},
               {'as': A, 'rpc': 'admin_update_plan', 'args': {'p_plan': 'basic', 'p_price_cents': 1, 'p_table_limit': 5000, 'p_join_limit': 1, 'p_active': True}},
               {'as': U, 'rpc': 'admin_update_plan', 'args': {'p_plan': 'basic', 'p_price_cents': 1, 'p_table_limit': 1, 'p_join_limit': 1, 'p_active': True}},
               {'as': U, 'rpc': 'my_plan'},
               {'as': A, 'rpc': 'admin_plans_overview'}]},
    {'name': 'admin_plans_overview stats + permissions',
     'steps': [{'sql': SUB.format(a=40, b=3, c=999, e=U)},
               {'sql': SUB.format(a=2, b=3, c=2499, e=U2)},
               {'sql': SUB.format(a=2, b=30, c=0, e=U2)},
               {'sql': SUB.format(a=60, b=-10, c=5999, e='jeta.rexhepi@gmail.com')},
               {'as': U2, 'rpc': 'request_premium', 'args': {'p_plan': 'premium_1m'}},
               {'as': A, 'rpc': 'admin_plans_overview'},
               {'as': U, 'rpc': 'admin_plans_overview'},
               {'as': None, 'rpc': 'admin_plans_overview'}]},
]
