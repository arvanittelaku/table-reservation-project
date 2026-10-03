-- Local development seed (never run on the real database).
-- Admin: support@ejabashkohu.com / Test1234!   Users: <first>.<last>@gmail.com / Test1234!
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
SELECT setseed(0.42);
-- admin
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at, created_at) VALUES
 ('00000000-0000-0000-0000-00000000000a','support@ejabashkohu.com','{"first_name":"Arvanit","last_name":"Telaku","age":29}', now(), now(), now() - interval '80 days');
UPDATE public.profiles SET is_admin = true, created_at = now() - interval '80 days' WHERE id = '00000000-0000-0000-0000-00000000000a';
-- 46 users
WITH names(fn, ln) AS (
  SELECT * FROM unnest(
    ARRAY['Arta','Blerim','Donika','Erion','Fjolla','Gentrit','Hana','Ilir','Jeta','Kushtrim','Lirije','Mergim','Nora','Orik','Pranvera','Qendrim','Rina','Shkumbin','Teuta','Uran','Vesa','Ylli','Zana','Agon','Besa','Dardan','Elira','Fatos','Gresa','Lorik','Mimoza','Njomza','Petrit','Rrezarta','Sara','Valon','Dua','Liam','Emma','Lukas','Ana','Marko','Elena','Stefan','Mia','Noah'],
    ARRAY['Krasniqi','Gashi','Berisha','Morina','Hoxha','Shala','Bytyqi','Kelmendi','Rexhepi','Hasani','Musliu','Zeqiri','Rama','Ahmeti','Sylaj','Dervishi','Halili','Mustafa','Osmani','Ismaili','Kastrati','Avdiu','Thaçi','Begolli','Hyseni','Maloku','Dobruna','Jashari','Leka','Bajrami','Pllana','Tahiri','Kryeziu','Salihu','Gjoka','Mehmeti','Lipa','Weber','Schmidt','Müller','Petrovska','Nikolov','Stojanova','Jovanov','Fischer','Brown'])
)
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at, created_at)
SELECT gen_random_uuid(), lower(fn) || '.' || lower(replace(ln,'ç','c')) || '@gmail.com',
       jsonb_build_object('first_name', fn, 'last_name', ln, 'age', 18 + (random()*30)::int),
       CASE WHEN random() < 0.9 THEN now() END,
       CASE WHEN random() < 0.85 THEN now() - (random()*20 || ' days')::interval END,
       now() - ((random()^2)*75 || ' days')::interval
FROM names;
UPDATE public.profiles p SET created_at = u.created_at,
  is_tourist = (random() < 0.15), from_place = CASE WHEN random() < 0.15 THEN 'Berlin' END
FROM auth.users u WHERE u.id = p.id AND p.id <> '00000000-0000-0000-0000-00000000000a';
-- every seeded account finished onboarding (the app now requires it to host/join)
UPDATE public.profiles SET onboarded_at = COALESCE(onboarded_at, created_at);
-- local test password for every seeded account: Test1234!  (bcrypt, same format Supabase stores)
UPDATE auth.users SET encrypted_password = extensions.crypt('Test1234!', extensions.gen_salt('bf', 10));
-- tables
CREATE TEMP TABLE hosts AS SELECT id, row_number() over () AS rn FROM (SELECT id FROM public.profiles WHERE NOT is_admin ORDER BY random() LIMIT 18) s;
INSERT INTO public.tables (host_id, kind, category, title, city, to_city, time_label, spots, event_datetime, created_at, maps_link, women_only, description)
SELECT h.id,
  k.kind,
  CASE k.kind WHEN 'vozitje' THEN 'vozitje' ELSE (ARRAY['kafe','ushqim','sport','natyre','kulture'])[1 + (g % 5)] END,
  CASE k.kind WHEN 'vozitje' THEN (ARRAY['Prishtinë → Prizren','Pejë → Prishtinë','Prishtinë → Shkup','Gjakovë → Prishtinë'])[1 + g % 4]
              WHEN 'udhetim' THEN (ARRAY['Rugova weekend','Brezovica ski','Valbonë hike'])[1 + g % 3]
              ELSE (ARRAY['Soma Book Station','Dit'' e Nat''','Liburnia','Baklori','Te Komiteti','Cafe Prishtina','Home Made','Pishat','Old Bazaar Gjakovë','Marashi Prizren'])[1 + g % 10] END,
  (ARRAY['Prishtinë','Prishtinë','Prishtinë','Prizren','Pejë','Gjakovë','Ferizaj'])[1 + g % 7],
  CASE k.kind WHEN 'vozitje' THEN 'Prizren' END,
  'Ora 19:00', 2 + (g % 6),
  c.created_at + ((1 + (g % 9)) || ' days')::interval,
  c.created_at,
  'https://maps.app.goo.gl/x' || g,
  (g % 11 = 0),
  'Hajde të njihemi! Tavolinë e hapur për këdo që do muhabet.'
FROM generate_series(1, 64) g
JOIN hosts h ON h.rn = 1 + (g % 18)
CROSS JOIN LATERAL (SELECT CASE WHEN g % 6 = 0 THEN 'vozitje' WHEN g % 13 = 0 THEN 'udhetim' ELSE 'tavoline' END AS kind) k
CROSS JOIN LATERAL (SELECT now() - ((60 - g) || ' days')::interval - ((g*37 % 24) || ' hours')::interval AS created_at) c;
UPDATE public.tables SET status = 'cancelled' WHERE title = 'Baklori' AND event_datetime < now();
-- guests
INSERT INTO public.requests (table_id, user_id, status, created_at)
SELECT t.id, p.id, 'confirmed', t.created_at + interval '2 hours'
FROM public.tables t
CROSS JOIN LATERAL (SELECT id FROM public.profiles WHERE id <> t.host_id AND NOT is_admin ORDER BY md5(id::text || t.id::text) LIMIT greatest(0, t.spots - 1 - (abs(hashtext(t.id::text)) % 3))) p
WHERE t.status <> 'cancelled'
ON CONFLICT DO NOTHING;
INSERT INTO public.memberships (table_id, user_id, role, joined_at)
SELECT table_id, user_id, 'member', created_at FROM public.requests WHERE status = 'confirmed' ON CONFLICT DO NOTHING;
-- payments for non-ride guests (stub, like production today)
INSERT INTO public.payments (user_id, table_id, amount_cents, provider, provider_ref, ticket_code, created_at)
SELECT m.user_id, m.table_id, 200, 'stub', 'STUB-' || (extract(epoch from m.joined_at)*1000)::bigint, 'EBK-' || (1000 + row_number() over ())::text, m.joined_at
FROM public.memberships m JOIN public.tables t ON t.id = m.table_id
WHERE m.role = 'member' AND t.kind <> 'vozitje';
-- pending + approved requests on upcoming tables
INSERT INTO public.requests (table_id, user_id, status, created_at)
SELECT t.id, p.id, (ARRAY['pending','approved','pending'])[1 + abs(hashtext(p.id::text)) % 3], now() - interval '3 hours'
FROM public.tables t
CROSS JOIN LATERAL (SELECT id FROM public.profiles pr WHERE pr.id <> t.host_id AND NOT pr.is_admin
   AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.table_id = t.id AND m.user_id = pr.id) ORDER BY random() LIMIT 2) p
WHERE t.event_datetime > now() AND t.status = 'open'
ON CONFLICT DO NOTHING;
-- chat
INSERT INTO public.messages (table_id, sender_id, body, created_at)
SELECT m.table_id, m.user_id, 'Mirë se vini! Shihemi aty.', m.joined_at + interval '1 hour' FROM public.memberships m WHERE random() < 0.6;
-- reports, bans, blocks
WITH ppl AS (SELECT id, row_number() over (order by created_at) rn FROM public.profiles WHERE NOT is_admin)
INSERT INTO public.reports (reporter_id, reported_id, reason, details, status, created_at)
SELECT a.id, b.id, r.reason, r.details, r.status, now() - (r.ago || ' hours')::interval
FROM (VALUES (3, 7, 'Foto e rreme', 'Personi në takim nuk ishte ai në foto. Dukej shumë më i vjetër.', 'pending', 5),
             (9, 7, 'Sjellje e papërshtatshme', 'Bëri komente të pahijshme gjatë darkës.', 'pending', 26),
             (12, 15, 'Spam', 'Dërgon link reklamash në chat.', 'pending', 50),
             (4, 21, 'Nuk erdhi', NULL, 'reviewed_dismissed', 120),
             (5, 30, 'Ngacmim', 'Mesazhe të vazhdueshme pas takimit.', 'reviewed_banned', 200)) r(a, b, reason, details, status, ago)
JOIN ppl a ON a.rn = r.a JOIN ppl b ON b.rn = r.b;
WITH ppl AS (SELECT id, row_number() over (order by created_at) rn FROM public.profiles WHERE NOT is_admin)
INSERT INTO public.bans (user_id, reason, created_at)
SELECT p.id, r.reason, now() - (r.ago || ' days')::interval FROM (VALUES (30, 'Ngacmim', 8), (30, 'Mesazhe abuzive', 2), (22, 'Profil i rremë', 15)) r(n, reason, ago) JOIN ppl p ON p.rn = r.n;
WITH ppl AS (SELECT id, row_number() over (order by created_at) rn FROM public.profiles WHERE NOT is_admin)
INSERT INTO public.blocks (blocker_id, blocked_id) SELECT a.id, b.id FROM ppl a, ppl b WHERE b.rn = 7 AND a.rn IN (3, 9, 11);
UPDATE public.profiles SET deactivated_at = now() - interval '4 days' WHERE id = (SELECT id FROM public.profiles WHERE NOT is_admin ORDER BY created_at OFFSET 40 LIMIT 1);
-- wednesday
INSERT INTO public.wednesday_groups (city, dinner_date, restaurant_id)
SELECT 'Prishtinë', d, (SELECT id FROM public.wednesday_restaurants WHERE city='Prishtinë' ORDER BY md5(d::text) LIMIT 1)
FROM (VALUES (date_trunc('day', now()) + interval '5 days 20 hours'), (date_trunc('day', now()) + interval '12 hours'), (date_trunc('day', now()) - interval '2 days' + interval '20 hours')) v(d);
INSERT INTO public.wednesday_participants (group_id, user_id)
SELECT g.id, p.id FROM public.wednesday_groups g CROSS JOIN LATERAL (SELECT id FROM public.profiles WHERE NOT is_admin ORDER BY md5(id::text || g.id::text) LIMIT 5) p;
SELECT 'users', count(*) FROM public.profiles UNION ALL SELECT 'tables', count(*) FROM public.tables UNION ALL SELECT 'payments', count(*) FROM public.payments UNION ALL SELECT 'members', count(*) FROM public.memberships UNION ALL SELECT 'requests', count(*) FROM public.requests;
-- like the plans migration's backfill: home city = the city each user hosts most, else Prishtinë
UPDATE public.profiles p SET home_city = COALESCE(
  (SELECT t.city FROM public.tables t WHERE t.host_id = p.id GROUP BY t.city ORDER BY count(*) DESC LIMIT 1), 'Prishtinë')
WHERE p.home_city IS NULL AND NOT p.is_admin;
