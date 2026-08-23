-- ═══════════════════════════════════════════════════════════════════
--  HAJDE! — SKEMA E PLOTË E BACKEND-IT (Supabase / PostgreSQL)
--  Ekzekutohet një herë në SQL Editor të Supabase, nga fillimi në fund.
--  Përfshin: tabelat, kufizimet, indekset, triggerat, funksionet RPC
--  dhe Row Level Security për ÇDO tabelë.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────── 1. PROFILET ─────────────────────────
-- Lidhet 1:1 me auth.users (fjalëkalimet i menaxhon Supabase Auth,
-- të hash-uara me bcrypt — ne kurrë s'i shohim).

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  first_name    text not null check (char_length(first_name) between 1 and 40),
  last_name     text not null check (char_length(last_name) between 1 and 40),
  age           int  not null check (age between 18 and 99),        -- 18+ i detyruar nga databaza
  photo_path    text,                                               -- rruga në Storage (jo URL publike)
  photo_face_ok boolean not null default false,                     -- kontrolli i fytyrës në server
  is_tourist    boolean not null default false,
  from_place    text,
  langs         text[] not null default array['Shqip'],
  verified      boolean not null default false,
  rating        numeric(3,2) not null default 5.00 check (rating between 0 and 5),
  tables_hosted int not null default 0,
  created_at    timestamptz not null default now()
);

-- Krijohet automatikisht kur regjistrohet një user i ri
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name, age)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', 'Përdorues'),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    greatest(18, coalesce((new.raw_user_meta_data->>'age')::int, 18))
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────── 2. PROFILI I SHIJEVE (kuizi) ───────────────────
create table public.taste_profiles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  group_size text check (group_size in ('vogla','mesatare','medha')),
  depth      text check (depth in ('thella','argetim','te-dyja')),
  time_pref  text check (time_pref in ('paradite','pasdite','mbremje')),
  energy     text check (energy in ('introvert','mes','ekstrovert')),
  interests  text[] not null default '{}',
  field      text, biz_sport text, weekend text, role text, music text,
  freq       text, organizer text, humor text, new_people text,
  done       boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Afiniteti i mësuar nga sjellja (pjesëmarrje + vlerësime)
create table public.affinity (
  user_id  uuid references public.profiles(id) on delete cascade,
  category text not null,
  score    int not null default 0 check (score between -40 and 40),
  primary key (user_id, category)
);

-- ───────────────────── 3. TAVOLINAT / VOZITJET / UDHËTIMET ─────────────────────
create table public.tables (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'tavoline' check (kind in ('tavoline','vozitje','udhetim','darka_e_merkures')),
  category    text not null,
  title       text not null check (char_length(title) between 2 and 120),  -- emri i vendit / "Prishtinë → Prizren" / destinacioni
  area        text,
  city        text not null,
  to_city     text,                       -- vetëm për vozitje
  budget      text,                       -- vetëm për udhëtime (informativ)
  maps_link   text check (maps_link is null or maps_link ~* '^https?://(www\.)?(google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)'),
  time_label  text not null,              -- "Sot, 17:00" / "12–14 gusht"
  starts_at   timestamptz,                -- për renditje/kujtesa kur dihet saktë
  spots       int not null check (spots between 1 and 20),
  women_only  boolean not null default false,
  mystery     boolean not null default false,   -- Darka e së Mërkurës: vendi i fshehur
  revealed    boolean not null default true,
  langs       text[] not null default array['Shqip'],
  tags        text[] not null default '{}',
  description text not null default '',
  status      text not null default 'open' check (status in ('open','full','done','cancelled')),
  created_at  timestamptz not null default now()
);
create index idx_tables_city_cat on public.tables (city, category) where status = 'open';
create index idx_tables_host on public.tables (host_id);

-- Numëruesi i tavolinave të mbajtura
create or replace function public.bump_tables_hosted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set tables_hosted = tables_hosted + 1 where id = new.host_id;
  return new;
end $$;
create trigger trg_bump_hosted after insert on public.tables
  for each row execute function public.bump_tables_hosted();

-- ───────────────────── 4. ANËTARËSIA (kush është ulur) ─────────────────────
create table public.memberships (
  table_id  uuid references public.tables(id) on delete cascade,
  user_id   uuid references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('host','member')),
  joined_at timestamptz not null default now(),
  primary key (table_id, user_id)
);
create index idx_memberships_user on public.memberships (user_id);

-- Nikoqiri futet automatikisht si anëtar
create or replace function public.host_auto_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (table_id, user_id, role) values (new.id, new.host_id, 'host');
  return new;
end $$;
create trigger trg_host_member after insert on public.tables
  for each row execute function public.host_auto_membership();

-- ───────────────────── 5. KËRKESAT (aprovimi i nikoqirit) ─────────────────────
create table public.requests (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.tables(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','approved','rejected','confirmed','expired')),
  created_at timestamptz not null default now(),
  unique (table_id, user_id)
);
create index idx_requests_table on public.requests (table_id) where status = 'pending';

-- Njoftim te nikoqiri kur vjen kërkesë; te kërkuesi kur aprovohet/refuzohet
create or replace function public.notify_on_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_title text; v_name text;
begin
  select host_id, title into v_host, v_title from public.tables where id = coalesce(new.table_id, old.table_id);
  select first_name || ' ' || last_name into v_name from public.profiles where id = new.user_id;
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, icon, body)
    values (v_host, '🙋', v_name || ' kërkon t''i bashkohet "' || v_title || '". Shiko profilin dhe vendos.');
  elsif tg_op = 'UPDATE' and new.status = 'approved' and old.status = 'pending' then
    insert into public.notifications (user_id, icon, body)
    values (new.user_id, '✅', 'U aprovove për "' || v_title || '". Konfirmo vendin.');
  end if;
  return new;
end $$;
create trigger trg_notify_request after insert or update on public.requests
  for each row execute function public.notify_on_request();

-- ───────────────────── 6. LISTA E PRITJES ─────────────────────
create table public.waitlist (
  table_id   uuid references public.tables(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (table_id, user_id)
);

-- Kur dikush largohet nga një tavolinë e plotë → njofto të parin në radhë
create or replace function public.notify_waitlist_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_next uuid; v_title text;
begin
  select user_id into v_next from public.waitlist
    where table_id = old.table_id order by created_at limit 1;
  if v_next is not null then
    select title into v_title from public.tables where id = old.table_id;
    insert into public.requests (table_id, user_id, status)
      values (old.table_id, v_next, 'approved')
      on conflict (table_id, user_id) do update set status = 'approved';
    delete from public.waitlist where table_id = old.table_id and user_id = v_next;
    insert into public.notifications (user_id, icon, body)
      values (v_next, '🔔', 'U lirua një vend te "' || v_title || '" — ishe i pari në radhë! Konfirmoje.');
  end if;
  return old;
end $$;
create trigger trg_waitlist_leave after delete on public.memberships
  for each row when (old.role = 'member')
  execute function public.notify_waitlist_on_leave();

-- ───────────────────── 7. CHAT-I I TAVOLINËS ─────────────────────
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.tables(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index idx_messages_table on public.messages (table_id, created_at);

-- ───────────────────── 8. PAGESAT (PA të dhëna kartelash!) ─────────────────────
-- Kartelat i mban procesori i certifikuar PCI-DSS. Ne ruajmë vetëm referencën.
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id),
  table_id      uuid not null references public.tables(id),
  amount_cents  int not null check (amount_cents >= 0),
  currency      text not null default 'EUR',
  provider      text not null,                    -- 'teb' | 'paddle' | 'paypal' …
  provider_ref  text not null,                    -- ID e transaksionit te procesori
  status        text not null default 'paid' check (status in ('paid','failed','void')),
  ticket_code   text unique,                      -- EBK-XXXX
  refundable    boolean not null default false,   -- politika: PA rimbursim
  created_at    timestamptz not null default now(),
  unique (user_id, table_id)
);

-- ───────────────────── 9. VLERËSIMET ─────────────────────
create table public.ratings (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.tables(id) on delete cascade,
  rater_id   uuid not null references public.profiles(id) on delete cascade,
  stars      int not null check (stars between 1 and 5),
  meet_again boolean,
  created_at timestamptz not null default now(),
  unique (table_id, rater_id)
);

-- Përditëso mesataren e nikoqirit + afinitetin e vlerësuesit
create or replace function public.apply_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_cat text;
begin
  select host_id, category into v_host, v_cat from public.tables where id = new.table_id;
  update public.profiles p set rating = sub.avg_r
    from (select round(avg(r.stars)::numeric, 2) as avg_r
          from public.ratings r join public.tables t on t.id = r.table_id
          where t.host_id = v_host) sub
    where p.id = v_host;
  insert into public.affinity (user_id, category, score)
    values (new.rater_id, v_cat, (new.stars - 3) * 4)
    on conflict (user_id, category)
    do update set score = greatest(-40, least(40, public.affinity.score + (new.stars - 3) * 4));
  return new;
end $$;
create trigger trg_apply_rating after insert on public.ratings
  for each row execute function public.apply_rating();

-- ───────────────────── 10. LIDHJET (përputhja e ndërsjellë) ─────────────────────
create table public.connection_picks (
  table_id  uuid references public.tables(id) on delete cascade,
  picker_id uuid references public.profiles(id) on delete cascade,
  picked_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (table_id, picker_id, picked_id),
  check (picker_id <> picked_id)
);

create table public.connections (
  a uuid references public.profiles(id) on delete cascade,
  b uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)              -- ruhet vetëm një herë, e renditur
);

-- Kur zgjedhja bëhet e ndërsjellë → krijo lidhjen + njofto të dy
create or replace function public.check_mutual_pick()
returns trigger language plpgsql security definer set search_path = public as $$
declare lo uuid; hi uuid;
begin
  if exists (select 1 from public.connection_picks
             where table_id = new.table_id and picker_id = new.picked_id and picked_id = new.picker_id) then
    lo := least(new.picker_id, new.picked_id);
    hi := greatest(new.picker_id, new.picked_id);
    insert into public.connections (a, b) values (lo, hi) on conflict do nothing;
    insert into public.notifications (user_id, icon, body)
      select u, '💫', 'Përputhje e ndërsjellë! Chat-i privat u hap te "Lidhjet e mia".'
      from unnest(array[lo, hi]) as u;
  end if;
  return new;
end $$;
create trigger trg_mutual_pick after insert on public.connection_picks
  for each row execute function public.check_mutual_pick();

-- ───────────────────── 11. NJOFTIMET ─────────────────────
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  icon       text not null default '🔔',
  body       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_user on public.notifications (user_id, read, created_at desc);

-- ───────────────────── 12. SIGURIA: RAPORTIMET & BLLOKIMET ─────────────────────
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  table_id    uuid references public.tables(id) on delete set null,
  reason      text not null,
  details     text,
  created_at  timestamptz not null default now()
);

create table public.blocks (
  blocker_id uuid references public.profiles(id) on delete cascade,
  blocked_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ───────────────────── 13. DISTINKTIVAT ─────────────────────
create table public.badges (
  user_id   uuid references public.profiles(id) on delete cascade,
  badge_id  text not null,       -- 'profil' | 'first-join' | 'first-host' | 'first-rate' | 'first-conn'
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- ═══════════════════════════════════════════════════════════════════
--  RPC-të (veprimet e sigurta — thirren nga aplikacioni)
-- ═══════════════════════════════════════════════════════════════════

-- Kërko t'i bashkohesh (me të gjitha kontrollet në server)
create or replace function public.request_join(p_table uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_req uuid; v_host uuid; v_spots int; v_count int;
begin
  select host_id, spots into v_host, v_spots from public.tables where id = p_table and status = 'open';
  if v_host is null then raise exception 'Tavolina nuk ekziston ose është mbyllur'; end if;
  if v_host = auth.uid() then raise exception 'Je vetë nikoqiri'; end if;
  if exists (select 1 from public.blocks where (blocker_id = v_host and blocked_id = auth.uid())
                                            or (blocker_id = auth.uid() and blocked_id = v_host)) then
    raise exception 'Veprimi nuk lejohet';
  end if;
  select count(*) into v_count from public.memberships where table_id = p_table;
  if v_count >= v_spots then raise exception 'Tavolina është plot — futu në listën e pritjes'; end if;
  insert into public.requests (table_id, user_id) values (p_table, auth.uid())
    returning id into v_req;
  return v_req;
end $$;

-- Nikoqiri aprovon një kërkesë
create or replace function public.approve_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_table uuid; v_host uuid;
begin
  select r.table_id, t.host_id into v_table, v_host
    from public.requests r join public.tables t on t.id = r.table_id
    where r.id = p_request and r.status = 'pending';
  if v_host is null then raise exception 'Kërkesa nuk u gjet'; end if;
  if v_host <> auth.uid() then raise exception 'Vetëm nikoqiri mund të aprovojë'; end if;
  update public.requests set status = 'approved' where id = p_request;
end $$;

-- Nikoqiri refuzon (diskret — pa arsye të dukshme)
create or replace function public.reject_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.requests r set status = 'rejected'
    from public.tables t
    where r.id = p_request and t.id = r.table_id and t.host_id = auth.uid() and r.status = 'pending';
end $$;

-- Konfirmimi FALAS (vozitjet): approved → anëtar, pa pagesë
create or replace function public.confirm_free_seat(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_kind text; v_spots int; v_count int;
begin
  select kind, spots into v_kind, v_spots from public.tables where id = p_table;
  if v_kind <> 'vozitje' then raise exception 'Vetëm vozitjet konfirmohen falas'; end if;
  if not exists (select 1 from public.requests
                 where table_id = p_table and user_id = auth.uid() and status = 'approved') then
    raise exception 'S''je i aprovuar për këtë vozitje';
  end if;
  select count(*) into v_count from public.memberships where table_id = p_table;
  if v_count >= v_spots then raise exception 'Ulëset u mbushën'; end if;
  insert into public.memberships (table_id, user_id) values (p_table, auth.uid());
  update public.requests set status = 'confirmed' where table_id = p_table and user_id = auth.uid();
end $$;

-- Konfirmimi ME PAGESË: thirret VETËM nga webhook-u i pagesës (service role),
-- pasi procesori konfirmon transaksionin. Kurrë nga klienti direkt.
create or replace function public.confirm_paid_seat(
  p_user uuid, p_table uuid, p_amount_cents int, p_provider text, p_provider_ref text
) returns text language plpgsql security definer set search_path = public as $$
declare v_ticket text;
begin
  if not exists (select 1 from public.requests
                 where table_id = p_table and user_id = p_user and status = 'approved') then
    raise exception 'Pagesë pa aprovim — refuzohet';
  end if;
  v_ticket := 'EBK-' || lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
  insert into public.payments (user_id, table_id, amount_cents, provider, provider_ref, ticket_code)
    values (p_user, p_table, p_amount_cents, p_provider, p_provider_ref, v_ticket);
  insert into public.memberships (table_id, user_id) values (p_table, p_user);
  update public.requests set status = 'confirmed' where table_id = p_table and user_id = p_user;
  insert into public.notifications (user_id, icon, body)
    values (p_user, '🎟️', 'Vendi u konfirmua! Bileta jote: ' || v_ticket);
  return v_ticket;
end $$;
revoke execute on function public.confirm_paid_seat from public, anon, authenticated;
-- ↑ vetëm service_role (webhook-u) mund ta thërrasë

-- Largimi (PA rimbursim — pagesa mbetet e regjistruar si 'paid')
create or replace function public.leave_table(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.memberships where table_id = p_table and user_id = auth.uid() and role = 'member';
  delete from public.requests where table_id = p_table and user_id = auth.uid();
end $$;

-- ═══════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY — zemra e sigurisë
--  Rregullat zbatohen nga vetë databaza, pavarësisht se kush e thërret API-n.
-- ═══════════════════════════════════════════════════════════════════

alter table public.profiles          enable row level security;
alter table public.taste_profiles    enable row level security;
alter table public.affinity          enable row level security;
alter table public.tables            enable row level security;
alter table public.memberships       enable row level security;
alter table public.requests          enable row level security;
alter table public.waitlist          enable row level security;
alter table public.messages          enable row level security;
alter table public.payments          enable row level security;
alter table public.ratings           enable row level security;
alter table public.connection_picks  enable row level security;
alter table public.connections       enable row level security;
alter table public.notifications     enable row level security;
alter table public.reports           enable row level security;
alter table public.blocks            enable row level security;
alter table public.badges            enable row level security;

-- PROFILES: të gjithë të kyçurit shohin profile bazë (dritarja e profilit);
-- vetëm pronari e ndryshon të vetin.
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and age >= 18);

-- TASTE_PROFILES & AFFINITY: rreptësisht private — vetëm pronari.
create policy taste_own on public.taste_profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy affinity_own_select on public.affinity
  for select to authenticated using (user_id = auth.uid());

-- TABLES: shihen nga të gjithë të kyçurit, PËRVEÇ kur ka bllokim mes teje e nikoqirit.
create policy tables_select on public.tables
  for select to authenticated using (
    not exists (select 1 from public.blocks
                where (blocker_id = auth.uid() and blocked_id = host_id)
                   or (blocker_id = host_id and blocked_id = auth.uid()))
  );
create policy tables_insert on public.tables
  for insert to authenticated with check (host_id = auth.uid());
create policy tables_update_host on public.tables
  for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy tables_delete_host on public.tables
  for delete to authenticated using (host_id = auth.uid());

-- MEMBERSHIPS: i sheh kushdo i kyçur (numri i vendeve është publik);
-- ndryshimet normalisht përmes RPC-ve (security definer).
create policy memberships_select on public.memberships
  for select to authenticated using (true);

-- STUB POLICIES: Remove when confirm_paid_seat webhook is live
-- Real flow: webhook calls confirm_paid_seat with service role only
create policy memberships_insert_self_approved on public.memberships
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.requests r
      where r.table_id = memberships.table_id
        and r.user_id = auth.uid()
        and r.status = 'approved'
    )
  );

-- REQUESTS: i sheh VETËM nikoqiri i tavolinës dhe vetë kërkuesi.
create policy requests_select on public.requests
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.tables t where t.id = table_id and t.host_id = auth.uid())
  );
-- insert/update normally via RPCs; stub allows guest to confirm after approval
create policy requests_update_own_confirm on public.requests
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- WAITLIST: e sheh vetë personi + nikoqiri; futesh/del vetëm vetë.
create policy waitlist_select on public.waitlist
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.tables t where t.id = table_id and t.host_id = auth.uid())
  );
create policy waitlist_insert_own on public.waitlist
  for insert to authenticated with check (user_id = auth.uid());
create policy waitlist_delete_own on public.waitlist
  for delete to authenticated using (user_id = auth.uid());

-- MESSAGES: chat-in e lexojnë e shkruajnë VETËM anëtarët e asaj tavoline.
create policy messages_select_members on public.messages
  for select to authenticated using (
    exists (select 1 from public.memberships m where m.table_id = messages.table_id and m.user_id = auth.uid())
  );
create policy messages_insert_members on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (select 1 from public.memberships m where m.table_id = messages.table_id and m.user_id = auth.uid())
  );

-- PAYMENTS: i sheh vetëm pronari; shkruhen nga webhook (service role) ose stub klienti.
create policy payments_select_own on public.payments
  for select to authenticated using (user_id = auth.uid());
-- STUB: remove when webhook is live
create policy payments_insert_own_stub on public.payments
  for insert to authenticated
  with check (user_id = auth.uid() and provider = 'stub');

-- RATINGS: vlerëson vetëm anëtari i tavolinës; leximi i hapur (ushqen yjet).
create policy ratings_select on public.ratings
  for select to authenticated using (true);
create policy ratings_insert_member on public.ratings
  for insert to authenticated with check (
    rater_id = auth.uid()
    and exists (select 1 from public.memberships m where m.table_id = ratings.table_id and m.user_id = auth.uid())
  );

-- CONNECTION_PICKS: zgjedhjet janë sekrete — i sheh vetëm zgjedhësi.
create policy picks_own on public.connection_picks
  for select to authenticated using (picker_id = auth.uid());
create policy picks_insert_own on public.connection_picks
  for insert to authenticated with check (
    picker_id = auth.uid()
    and exists (select 1 from public.memberships m where m.table_id = connection_picks.table_id and m.user_id = auth.uid())
  );

-- CONNECTIONS: i sheh vetëm pjesëmarrësi i lidhjes.
create policy connections_select_own on public.connections
  for select to authenticated using (a = auth.uid() or b = auth.uid());

-- NOTIFICATIONS: rreptësisht personale.
create policy notifications_own on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- REPORTS: raporton kushdo; i lexon VETËM ekipi (service role) — asnjë politikë select.
create policy reports_insert_own on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());

-- BLOCKS: menaxhon vetëm bllokuesi.
create policy blocks_own on public.blocks
  for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- BADGES: i sheh kushdo (profili), i shkruan vetëm sistemi/pronari.
create policy badges_select on public.badges
  for select to authenticated using (true);
create policy badges_insert_own on public.badges
  for insert to authenticated with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
--  REALTIME: aktivizo transmetimin live për chat, kërkesa e njoftime
-- ═══════════════════════════════════════════════════════════════════
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.requests;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.memberships;

-- FUND — skema është gati. Vazhdo me storage.sql.
