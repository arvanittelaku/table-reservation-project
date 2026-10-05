"""Wednesday dinners. Setup rows are inserted with times relative to
date_trunc('hour', now()) so both sides see identical values.

Restaurants are assigned with ORDER BY random() in the SQL (_form_wednesday_groups,
create_wednesday_dinner_group); cases use cities with a single active
restaurant (Ferizaj, Gjilan, Mitrovicë), or normalise restaurant_id afterwards."""
A = 'admin'
REN = "(select id from public.wednesday_restaurants where city = 'Ferizaj' and name = 'Renoma')"
REN_ID = '$sql:select id::text from public.wednesday_restaurants where city = \'Ferizaj\' and name = \'Renoma\''
# Own groups (seed groups/participants change on every rebuild): one revealed (in 2h), one not (in 5 days).
OWN_GROUPS = {'sql': "insert into public.wednesday_groups (city, dinner_date, restaurant_id) select 'Ferizaj', d, " + REN +
                     " from (values (date_trunc('hour', now()) + interval '2 hours'), (date_trunc('hour', now()) + interval '5 days')) v(d); "
                     "insert into public.wednesday_participants (group_id, user_id) select g.id, u.id from public.wednesday_groups g, auth.users u "
                     "where g.city = 'Ferizaj' and g.dinner_date > now() and u.email in ('agon.begolli@gmail.com', 'jeta.rexhepi@gmail.com')"}
G_SOON = "$sql:select id::text from public.wednesday_groups where city = 'Ferizaj' and dinner_date = date_trunc('hour', now()) + interval '2 hours'"
G_LATER = "$sql:select id::text from public.wednesday_groups where city = 'Ferizaj' and dinner_date = date_trunc('hour', now()) + interval '5 days'"
U = 'agon.begolli@gmail.com'          # Ferizaj, basic
DIN = "date_trunc('hour', now()) + interval '20 hours'"       # deadline passed (due)
LATER = "date_trunc('hour', now()) + interval '5 days'"       # not due yet


def sign(emails, city, din=DIN, status='signed_up', start=100):
    vals = ', '.join(f"('{e}', {start - i})" for i, e in enumerate(emails))
    return {'sql': f"insert into public.wednesday_signups (user_id, dinner_date, city, status, created_at) "
                   f"select u.id, {din}, '{city}', '{status}', date_trunc('hour', now()) - make_interval(mins => v.m) "
                   f"from (values {vals}) v(e, m) join auth.users u on u.email = v.e"}


def premium(email):
    return {'sql': "insert into public.subscriptions (user_id, plan_id, starts_at, ends_at, source) "
                   "select id, 'premium_1m', date_trunc('day', now()) - interval '1 day', date_trunc('day', now()) + interval '20 days', "
                   f"'admin_grant' from auth.users where email = '{email}'"}


FER = ['agon.begolli@gmail.com', 'emma.schmidt@gmail.com', 'jeta.rexhepi@gmail.com', 'rrezarta.salihu@gmail.com',
       'vesa.kastrati@gmail.com', 'arta.krasniqi@gmail.com', 'besa.hyseni@gmail.com', 'blerim.gashi@gmail.com']
MIT = ['dardan.maloku@gmail.com', 'donika.berisha@gmail.com', 'elena.stojanova@gmail.com']
GJI = ['elira.dobruna@gmail.com', 'erion.morina@gmail.com']
PRI = ['fatos.jashari@gmail.com', 'gentrit.shala@gmail.com', 'gresa.leka@gmail.com', 'hana.bytyqi@gmail.com',
       'ilir.kelmendi@gmail.com', 'kushtrim.hasani@gmail.com', 'liam.weber@gmail.com', 'lirije.musliu@gmail.com',
       'lorik.bajrami@gmail.com', 'marko.nikolov@gmail.com', 'mia.fischer@gmail.com', 'mimoza.pllana@gmail.com',
       'njomza.tahiri@gmail.com', 'noah.brown@gmail.com', 'nora.rama@gmail.com']
NORM_REST = {'sql': "update public.wednesday_groups set restaurant_id = (select id from public.wednesday_restaurants where city = 'Prishtinë' order by name limit 1) "
                    "where city = 'Prishtinë' and created_at > now() - interval '1 minute'"}

CASES = [
    {'name': 'form_due: premium first, last-week waitlist next, sizes, waitlist',
     'steps': [sign(FER, 'Ferizaj'),
               premium('blerim.gashi@gmail.com'),                     # signed up last, premium -> host
               sign(['besa.hyseni@gmail.com'], 'Ferizaj', din=f"{DIN} - interval '7 days'", status='waitlisted'),
               sign(MIT, 'Mitrovicë', start=50),
               sign(GJI, 'Gjilan', start=40),
               sign(['nora.rama@gmail.com'], 'Ferizaj', din=LATER),   # not due
               {'as': A, 'rpc': 'form_due_wednesday_groups'},
               {'as': 'blerim.gashi@gmail.com', 'rpc': 'my_wednesday'},
               {'as': 'vesa.kastrati@gmail.com', 'rpc': 'my_wednesday'},
               {'as': 'elira.dobruna@gmail.com', 'rpc': 'my_wednesday'},
               {'as': 'blerim.gashi@gmail.com', 'rpc': 'get_my_wednesday_groups'},
               {'as': A, 'rpc': 'admin_wednesday_signups'},
               {'as': A, 'rpc': 'form_due_wednesday_groups'}]},
    {'name': 'form: two groups in a city with random restaurants (normalised), remainder < 3 waits',
     'deep_unordered': True,  # the two new groups share created_at: their order is undefined in SQL too
     'steps': [sign(PRI, 'Prishtinë'),
               {'as': A, 'rpc': 'admin_form_wednesday'},
               NORM_REST,
               {'as': A, 'rpc': 'admin_list_wednesday'}]},
    {'name': 'form: restaurant already used that evening -> nobody grouped',
     'steps': [sign(FER[:4], 'Ferizaj'),
               {'sql': f"insert into public.wednesday_groups (city, dinner_date, restaurant_id) select 'Ferizaj', {DIN}, id from public.wednesday_restaurants where city = 'Ferizaj' and name = 'Renoma'"},
               {'as': A, 'rpc': 'form_due_wednesday_groups'}]},
    {'name': 'form_due permissions (user, anon) and nothing due',
     'steps': [{'as': U, 'rpc': 'form_due_wednesday_groups'},
               {'as': None, 'rpc': 'form_due_wednesday_groups'},
               {'as': A, 'rpc': 'form_due_wednesday_groups'}]},
    {'name': 'admin_form_wednesday explicit date / default / none / non-admin',
     'steps': [{'as': A, 'rpc': 'admin_form_wednesday'},
               sign(FER[:3], 'Ferizaj', din=LATER),
               {'as': U, 'rpc': 'admin_form_wednesday'},
               {'as': A, 'rpc': 'admin_form_wednesday', 'args': {'p_dinner': '$sql:select (' + DIN + ')::text'}},
               {'as': A, 'rpc': 'admin_form_wednesday', 'args': {'p_dinner': None}},
               {'as': A, 'rpc': 'admin_form_wednesday'}]},
    {'name': 'signup_wednesday basic flows',
     'steps': [{'as': U, 'rpc': 'my_wednesday'},
               {'as': U, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Prishtinë'}},
               {'as': U, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Atlantis'}},
               {'as': U, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Ferizaj', 'p_langs': ['sq', 'en']}},
               {'as': U, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Ferizaj'}},
               {'as': U, 'rpc': 'cancel_wednesday_signup'},
               {'as': U, 'rpc': 'my_wednesday'},
               {'sql': "update public.wednesday_signups set created_at = date_trunc('hour', now()) - interval '1 day'"},
               {'as': U, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Ferizaj', 'p_langs': None}},
               {'as': None, 'rpc': 'my_wednesday'},
               {'as': None, 'rpc': 'cancel_wednesday_signup'},
               {'as': None, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Ferizaj'}}]},
    {'name': 'signup_wednesday premium other city; grouped signup is not overwritten; deactivated',
     'steps': [premium(U),
               {'as': U, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Prishtinë'}},
               {'sql': "update public.wednesday_signups set status = 'grouped'"},
               {'as': U, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Pejë'}},
               {'as': A, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Gjilan'}},
               {'as': A, 'rpc': 'admin_wednesday_signups'},
               {'as': 'stefan.jovanov@gmail.com', 'rpc': 'signup_wednesday', 'args': {'p_city': 'Prishtinë'}}]},
    {'name': 'existing groups: my groups, restaurant reveal, non-participant',
     'steps': [OWN_GROUPS,
               {'as': 'agon.begolli@gmail.com', 'rpc': 'get_my_wednesday_groups'},
               {'as': None, 'rpc': 'get_my_wednesday_groups'},
               {'as': 'agon.begolli@gmail.com', 'rpc': 'get_wednesday_restaurant', 'args': {'p_group': G_LATER}},
               {'as': 'jeta.rexhepi@gmail.com', 'rpc': 'get_wednesday_restaurant', 'args': {'p_group': G_SOON}},
               {'as': 'emma.schmidt@gmail.com', 'rpc': 'get_wednesday_restaurant', 'args': {'p_group': G_SOON}},
               {'as': None, 'rpc': 'get_wednesday_restaurant', 'args': {'p_group': G_SOON}},
               {'as': A, 'rpc': 'admin_list_wednesday'},
               {'as': U, 'rpc': 'admin_list_wednesday'}]},
    {'name': 'create_wednesday_dinner_group',
     'steps': [{'as': U, 'rpc': 'create_wednesday_dinner_group', 'args': {'p_city': 'Ferizaj', 'p_dinner_date': '$now+3d'}},
               {'as': U, 'rpc': 'get_wednesday_restaurant', 'args': {'p_group': '$0'}},
               {'as': U, 'rpc': 'create_wednesday_dinner_group', 'args': {'p_city': 'Atlantis', 'p_dinner_date': '$now+3d'}},
               {'as': None, 'rpc': 'create_wednesday_dinner_group', 'args': {'p_city': 'Ferizaj', 'p_dinner_date': '$now+3d'}}]},
    {'name': 'admin restaurants: upsert / activate / errors',
     'steps': [{'as': A, 'rpc': 'admin_upsert_restaurant', 'args': {'p_id': None, 'p_name': ' Te Bledi ', 'p_city': 'Gjilan ', 'p_address': 'Rr. 1', 'p_maps_link': ' '}},
               {'as': A, 'rpc': 'admin_upsert_restaurant', 'args': {'p_id': '$0', 'p_name': 'Bledi', 'p_city': 'Gjilan', 'p_address': 'Rr. 2', 'p_maps_link': 'HTTPS://maps.app.goo.gl/abc'}},
               {'as': A, 'rpc': 'admin_upsert_restaurant', 'args': {'p_id': None, 'p_name': 'X', 'p_city': 'Gjilan', 'p_address': 'Rr. 2', 'p_maps_link': None}},
               {'as': A, 'rpc': 'admin_upsert_restaurant', 'args': {'p_id': None, 'p_name': 'XY', 'p_city': 'Gjilan', 'p_address': 'Rr. 2', 'p_maps_link': 'https://evil.com/maps'}},
               {'as': A, 'rpc': 'admin_upsert_restaurant', 'args': {'p_id': '00000000-0000-0000-0000-000000000001', 'p_name': 'XY', 'p_city': 'Gjilan', 'p_address': 'Rr. 2', 'p_maps_link': 'https://www.google.com/maps/place/x'}},
               {'as': U, 'rpc': 'admin_upsert_restaurant', 'args': {'p_id': None, 'p_name': 'XY', 'p_city': 'Gjilan', 'p_address': 'Rr. 2', 'p_maps_link': None}},
               {'as': A, 'rpc': 'admin_set_restaurant_active', 'args': {'p_restaurant': '$0', 'p_active': False}},
               {'as': A, 'rpc': 'admin_set_restaurant_active', 'args': {'p_restaurant': '$0', 'p_active': True}},
               {'as': A, 'rpc': 'admin_set_restaurant_active', 'args': {'p_restaurant': '00000000-0000-0000-0000-000000000001', 'p_active': True}},
               {'as': U, 'rpc': 'admin_set_restaurant_active', 'args': {'p_restaurant': '$0', 'p_active': True}},
               {'as': A, 'rpc': 'admin_set_restaurant_active', 'args': {'p_restaurant': REN_ID, 'p_active': False}},
               {'as': U, 'rpc': 'signup_wednesday', 'args': {'p_city': 'Ferizaj'}},
               {'as': A, 'rpc': 'admin_list_wednesday'}]},
]

