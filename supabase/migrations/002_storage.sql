-- ==========================================================================
-- CASABLANCA — Storage buckets + policies
-- ==========================================================================

insert into storage.buckets (id, name, public)
values
  ('portfolio-videos',     'portfolio-videos',     true),
  ('portfolio-thumbnails', 'portfolio-thumbnails', true),
  ('social-proofs',        'social-proofs',        true)
on conflict (id) do nothing;

-- ---------- Policies por bucket -------------------------------------------
-- Leitura pública (os buckets são 'public', mas políticas garantem)
drop policy if exists "public read portfolio videos"      on storage.objects;
drop policy if exists "public read portfolio thumbnails"  on storage.objects;
drop policy if exists "public read social proofs"         on storage.objects;

create policy "public read portfolio videos" on storage.objects
  for select using (bucket_id = 'portfolio-videos');

create policy "public read portfolio thumbnails" on storage.objects
  for select using (bucket_id = 'portfolio-thumbnails');

create policy "public read social proofs" on storage.objects
  for select using (bucket_id = 'social-proofs');

-- Upload/Update/Delete: apenas o próprio dono (pasta com o user_id)
drop policy if exists "own upload portfolio videos"     on storage.objects;
drop policy if exists "own update portfolio videos"     on storage.objects;
drop policy if exists "own delete portfolio videos"     on storage.objects;

create policy "own upload portfolio videos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'portfolio-videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own update portfolio videos" on storage.objects
  for update to authenticated
  using (bucket_id = 'portfolio-videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own delete portfolio videos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'portfolio-videos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Thumbnails
drop policy if exists "own upload portfolio thumbnails" on storage.objects;
drop policy if exists "own update portfolio thumbnails" on storage.objects;
drop policy if exists "own delete portfolio thumbnails" on storage.objects;

create policy "own upload portfolio thumbnails" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'portfolio-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own update portfolio thumbnails" on storage.objects
  for update to authenticated
  using (bucket_id = 'portfolio-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own delete portfolio thumbnails" on storage.objects
  for delete to authenticated
  using (bucket_id = 'portfolio-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

-- Social proofs
drop policy if exists "own upload social proofs" on storage.objects;
drop policy if exists "own update social proofs" on storage.objects;
drop policy if exists "own delete social proofs" on storage.objects;

create policy "own upload social proofs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'social-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own update social proofs" on storage.objects
  for update to authenticated
  using (bucket_id = 'social-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own delete social proofs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'social-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
