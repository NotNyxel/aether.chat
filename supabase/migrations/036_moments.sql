-- 036: Moments (2.1). A photo, short video or text card that lasts 24 hours, shown as a ring
-- around your avatar. Each one picks its audience: everyone you know (friends and people in your
-- spaces), friends, or your close friends. The owner sees who viewed it.

-- Close friends: your own private list.
create table if not exists public.close_friends (
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  friend_id  uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index if not exists close_friends_friend on public.close_friends (friend_id);

-- Your ring colour: 'accent' (your profile accent), a hex colour, or a preset gradient name.
alter table public.users add column if not exists moment_ring text check (moment_ring is null or moment_ring ~ '^(accent|sunset|ocean|aurora|candy|#[0-9a-fA-F]{6})$');
grant update (moment_ring) on public.users to authenticated;

create table if not exists public.moments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  kind       text not null check (kind in ('image', 'video', 'text')),
  media_path text check (media_path is null or char_length(media_path) <= 300),
  body       text check (body is null or char_length(body) <= 300),
  background text check (background is null or background ~ '^#[0-9a-fA-F]{6}$'),
  audience   text not null default 'friends' check (audience in ('everyone', 'friends', 'close')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check ((kind = 'text') = (media_path is null)),
  check (kind <> 'text' or char_length(btrim(coalesce(body, ''))) > 0)
);
create index if not exists moments_user on public.moments (user_id, expires_at desc);

create table if not exists public.moment_views (
  moment_id uuid not null references public.moments (id) on delete cascade,
  viewer_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (moment_id, viewer_id)
);
create index if not exists moment_views_viewer on public.moment_views (viewer_id);

-- Can p_viewer see a moment p_owner shared with p_audience? (Owner always can.)
create or replace function public.can_see_moment(p_owner uuid, p_audience text, p_viewer uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_viewer is null then return false; end if;
  if p_owner = p_viewer then return true; end if;
  if public.is_blocked_between(p_owner, p_viewer) then return false; end if;
  return case p_audience
    when 'close' then exists (select 1 from public.close_friends c where c.user_id = p_owner and c.friend_id = p_viewer) and public.are_friends(p_owner, p_viewer)
    when 'friends' then public.are_friends(p_owner, p_viewer)
    else public.are_friends(p_owner, p_viewer) or public.shares_server(p_owner, p_viewer)
  end;
end;
$$;
revoke all on function public.can_see_moment(uuid, text, uuid) from public, anon;
grant execute on function public.can_see_moment(uuid, text, uuid) to authenticated;

create or replace function public.my_moment_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.moments where user_id = auth.uid() and expires_at > now()
$$;
revoke all on function public.my_moment_count() from public, anon;
grant execute on function public.my_moment_count() to authenticated;

-- Can the current user see this moment (by id)? Used by views and storage.
create or replace function public.moment_visible(p_moment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.moments m
     where m.id = p_moment and (m.user_id = auth.uid() or (m.expires_at > now() and public.can_see_moment(m.user_id, m.audience, auth.uid())))
  )
$$;
revoke all on function public.moment_visible(uuid) from public, anon;
grant execute on function public.moment_visible(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['close_friends', 'moments', 'moment_views'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
    execute format('drop policy if exists not_banned on public.%I', t);
    execute format('create policy not_banned on public.%I as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

drop policy if exists own on public.close_friends;
create policy own on public.close_friends for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, delete on public.close_friends to authenticated;

drop policy if exists see on public.moments;
create policy see on public.moments for select to authenticated
  using (user_id = (select auth.uid()) or (expires_at > now() and public.can_see_moment(user_id, audience, (select auth.uid()))));
drop policy if exists post_own on public.moments;
create policy post_own on public.moments for insert to authenticated
  with check (user_id = (select auth.uid()) and expires_at <= now() + interval '24 hours 5 minutes'
              and (media_path is null or media_path like (select auth.uid())::text || '/%'));
drop policy if exists delete_own on public.moments;
create policy delete_own on public.moments for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists moment_limit on public.moments;
create policy moment_limit on public.moments as restrictive for insert to authenticated with check (public.my_moment_count() < 30);
grant select, delete on public.moments to authenticated;
grant insert (kind, media_path, body, background, audience) on public.moments to authenticated;

drop policy if exists see_views on public.moment_views;
create policy see_views on public.moment_views for select to authenticated
  using (viewer_id = (select auth.uid()) or exists (select 1 from public.moments m where m.id = moment_id and m.user_id = (select auth.uid())));
drop policy if exists mark_seen on public.moment_views;
create policy mark_seen on public.moment_views for insert to authenticated
  with check (viewer_id = (select auth.uid()) and public.moment_visible(moment_id));
grant select on public.moment_views to authenticated;
grant insert (moment_id) on public.moment_views to authenticated;

-- Private storage: <uid>/<file>; readable by whoever can see the moment that uses it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('moments', 'moments', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'] where id = 'moments';
  end if;
end;
$$;
drop policy if exists "storage: moments upload own" on storage.objects;
create policy "storage: moments upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'moments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "storage: moments delete own" on storage.objects;
create policy "storage: moments delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'moments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "storage: moments read visible" on storage.objects;
create policy "storage: moments read visible" on storage.objects for select to authenticated
  using (bucket_id = 'moments' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.moments m where m.media_path = name and public.moment_visible(m.id))
  ));

-- Expired moments: gone after a week (they're hidden from everyone but you after 24 hours).
create or replace function public.purge_old_moments()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.moments where expires_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_old_moments() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'aether-purge-moments';
    perform cron.schedule('aether-purge-moments', '37 4 * * *', 'select public.purge_old_moments()');
  end if;
end;
$$;
