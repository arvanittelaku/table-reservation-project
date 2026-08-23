-- ═══════════════════════════════════════════════════════════════════
--  HAJDE! — STORAGE: fotot e profilit (private, me qasje të kontrolluar)
--  Ekzekutohet PAS schema.sql në SQL Editor të Supabase.
-- ═══════════════════════════════════════════════════════════════════

-- Bucket-i privat i avatarëve (JO publik — qasja vetëm për të kyçurit)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Çdo përdorues ngarkon VETËM në dosjen e vet: avatars/{user_id}/foto.jpg
create policy "avatar_upload_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Leximi: çdo i kyçur mund t'i shohë avatarët (dritarja e profilit i kërkon).
-- Të pakyçurit s'shohin ASGJË — bucket-i s'është publik.
create policy "avatar_read_authenticated" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

-- Shënim: në klient përdor createSignedUrl(path, 3600) — URL që skadon pas 1 ore,
-- kështu asnjë foto s'qarkullon me link të përhershëm.
