with nu as (
  insert into auth.users (
    instance_id, id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'ejabashkohu+banprod.' || floor(random() * 1000000)::text || '@gmail.com',
    crypt('testpass123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"BanProd","last_name":"Test"}'::jsonb,
    'authenticated',
    'authenticated',
    now(),
    now()
  )
  returning id, email
)
select id, email from nu;
