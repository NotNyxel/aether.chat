-- 042: Moments studio (2.3). Text, stickers, drawings and templates added to a moment are drawn
-- into the photo itself. A video can't be redrawn in the browser, so its additions are saved as a
-- transparent image (overlay_path) that the viewer shows on top of the video.

alter table public.moments add column if not exists overlay_path text
  check (overlay_path is null or (char_length(overlay_path) <= 300 and media_path is not null));
grant insert (overlay_path) on public.moments to authenticated;

-- Overlays live in the poster's folder, like the media itself.
drop policy if exists post_own on public.moments;
create policy post_own on public.moments for insert to authenticated
  with check (user_id = (select auth.uid()) and expires_at <= now() + interval '24 hours 5 minutes'
              and (media_path is null or media_path like (select auth.uid())::text || '/%')
              and (overlay_path is null or overlay_path like (select auth.uid())::text || '/%'));

-- Readable by whoever can see the moment that uses it (media or overlay).
drop policy if exists "storage: moments read visible" on storage.objects;
create policy "storage: moments read visible" on storage.objects for select to authenticated
  using (bucket_id = 'moments' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.moments m where (m.media_path = name or m.overlay_path = name) and public.moment_visible(m.id))
  ));
