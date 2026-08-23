-- Features 1-5 migration for ejaBashkohu (upxxfhvgbmddhyebaiug)

-- FEATURE 1: Wednesday dinner
create table if not exists public.wednesday_restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  address text not null,
  maps_link text,
  active boolean not null default true
);

insert into public.wednesday_restaurants (name, city, address, maps_link) values
  ('Liburnia', 'Prishtinë', 'Rr. Bulevardi Nënë Tereza', null),
  ('Tiffany', 'Prishtinë', 'Rr. Agim Ramadani', null),
  ('Renaissance', 'Prishtinë', 'Rr. Nazim Gafurri', null),
  ('Home Made', 'Prishtinë', 'Rr. Sylejman Vokshi', null),
  ('Pishat', 'Prishtinë', 'Rr. Ilaz Agushi', null),
  ('Soma Book Station', 'Prishtinë', 'Rr. Rexhep Luci', null),
  ('Miqt', 'Prishtinë', 'Rr. UÇK', null),
  ('Dit'' e Nat''', 'Prishtinë', 'Rr. Fehmi Agani', null),
  ('Baklori', 'Prishtinë', 'Bulevardi Bill Klinton', null),
  ('Trofta', 'Pejë', 'Rr. Skenderbeu', null),
  ('Elita', 'Pejë', 'Rr. Sylejman Vokshi', null),
  ('Marashi', 'Prizren', 'Lidhja e Prizrenit', null),
  ('Besimi', 'Prizren', 'Sheshi Shatërvani', null),
  ('Villa e Bardhe', 'Gjakovë', 'Çarshia e Madhe', null),
  ('Old Bazaar', 'Gjakovë', 'Çarshia e Vjetër', null),
  ('Renoma', 'Ferizaj', 'Rr. Ismail Qemali', null),
  ('Domus', 'Gjilan', 'Rr. Bulevardi i Pavarësisë', null),
  ('Fusion', 'Mitrovicë', 'Rr. Afrim Zhitia', null),
  ('Symphony', 'Prishtinë', 'Rr. Perandori Justinian', null),
  ('Home 87', 'Prishtinë', 'Rr. Fazli Grajçevci', null)
on conflict do nothing;

create table if not exists public.wednesday_groups (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  dinner_date timestamptz not null,
  restaurant_id uuid not null references public.wednesday_restaurants(id),
  created_at timestamptz not null default now()
);

create table if not exists public.wednesday_participants (
  group_id uuid references public.wednesday_groups(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (group_id, user_id)
);

alter table public.wednesday_restaurants enable row level security;
alter table public.wednesday_groups enable row level security;
alter table public.wednesday_participants enable row level security;

drop policy if exists wp_select_own on public.wednesday_participants;
create policy wp_select_own on public.wednesday_participants
  for select to authenticated using (user_id = auth.uid());

drop policy if exists wg_select_member on public.wednesday_groups;
create policy wg_select_member on public.wednesday_groups
  for select to authenticated using (
    exists (select 1 from public.wednesday_participants wp 
            where wp.group_id = id and wp.user_id = auth.uid())
  );

create or replace function public.get_wednesday_restaurant(p_group uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dinner_date timestamptz;
  v_restaurant_id uuid;
  v_name text;
  v_address text;
  v_maps_link text;
begin
  select dinner_date, restaurant_id into v_dinner_date, v_restaurant_id
  from public.wednesday_groups g
  where g.id = p_group
  and exists (select 1 from public.wednesday_participants wp 
              where wp.group_id = g.id and wp.user_id = auth.uid());

  if v_dinner_date is null then
    raise exception 'Grupi nuk ekziston ose s''je pjesëmarrës';
  end if;

  if now() < v_dinner_date - interval '24 hours' then
    return jsonb_build_object('name', null, 'address', null, 'maps_link', null, 'revealed', false);
  else
    select r.name, r.address, r.maps_link into v_name, v_address, v_maps_link
    from public.wednesday_restaurants r where r.id = v_restaurant_id;
    return jsonb_build_object('name', v_name, 'address', v_address, 'maps_link', v_maps_link, 'revealed', true);
  end if;
end $$;

create or replace function public.create_wednesday_dinner_group(
  p_city text,
  p_dinner_date timestamptz
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_restaurant_id uuid;
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Duhet të jesh i kyçur';
  end if;

  select id into v_restaurant_id
  from public.wednesday_restaurants
  where city = p_city and active = true
  order by random()
  limit 1;

  if v_restaurant_id is null then
    raise exception 'Nuk ka restorante për këtë qytet';
  end if;

  insert into public.wednesday_groups (city, dinner_date, restaurant_id)
  values (p_city, p_dinner_date, v_restaurant_id)
  returning id into v_group_id;

  insert into public.wednesday_participants (group_id, user_id)
  values (v_group_id, auth.uid())
  on conflict do nothing;

  return v_group_id;
end $$;

grant execute on function public.get_wednesday_restaurant(uuid) to authenticated, anon;
grant execute on function public.create_wednesday_dinner_group(text, timestamptz) to authenticated, anon;

-- FEATURE 3: Account deactivation
alter table public.profiles add column if not exists deactivated_at timestamptz;

drop policy if exists tables_select on public.tables;
create policy tables_select on public.tables
  for select to authenticated using (
    not exists (select 1 from public.blocks
                where (blocker_id = auth.uid() and blocked_id = host_id)
                   or (blocker_id = host_id and blocked_id = auth.uid()))
    and not exists (select 1 from public.profiles p 
                    where p.id = host_id and p.deactivated_at is not null)
  );

-- FEATURE 5: Ban system
create extension if not exists pg_net;

create table if not exists public.bans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.bans enable row level security;

drop policy if exists bans_select_own on public.bans;
create policy bans_select_own on public.bans
  for select to authenticated using (user_id = auth.uid());

create or replace function public.ban_user(p_user uuid, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare v_ban_count int;
begin
  insert into public.bans (user_id, reason) values (p_user, p_reason);
  select count(*) into v_ban_count from public.bans where user_id = p_user;

  insert into public.notifications (user_id, icon, body)
  values (p_user, 'warning', 
    'Llogaria juaj u pezullua. Arsyeja: ' || p_reason || 
    '. Pezullim ' || v_ban_count || '/3.');

  perform net.http_post(
    url := 'https://upxxfhvgbmddhyebaiug.supabase.co/functions/v1/notify-ban',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_key', true)
    ),
    body := jsonb_build_object(
      'user_id', p_user, 'reason', p_reason, 'ban_count', v_ban_count
    )
  );

  if v_ban_count >= 3 then
    perform net.http_post(
      url := 'https://upxxfhvgbmddhyebaiug.supabase.co/functions/v1/delete-banned-user',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_key', true)
      ),
      body := jsonb_build_object('user_id', p_user)
    );
  end if;

  return v_ban_count;
end $$;

revoke execute on function public.ban_user from public, anon, authenticated;

alter table public.reports alter column reason set not null;

notify pgrst, 'reload schema';
