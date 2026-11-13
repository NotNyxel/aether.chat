-- Aether 1.7.7: favourite GIFs (star a GIF in the picker, or save an image from chat as a GIF).
-- Run after 016_drafts_scheduled.sql. Private to each person.

create table if not exists public.gif_favorites (
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  url        text not null check (url ~ '^https://' and char_length(url) <= 2000),
  preview    text not null check (preview ~ '^https://' and char_length(preview) <= 2000),
  type       text not null default 'image/gif' check (type ~ '^(image|video)/[a-z0-9.+-]+$'),
  width      integer not null default 480 check (width between 1 and 8000),
  height     integer not null default 270 check (height between 1 and 8000),
  title      text not null default 'GIF' check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  primary key (user_id, url)
);
alter table public.gif_favorites enable row level security;

create or replace function public.gif_favorite_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.gif_favorites where user_id = auth.uid()
$$;
revoke all on function public.gif_favorite_count() from public, anon;
grant execute on function public.gif_favorite_count() to authenticated;

drop policy if exists gif_favorites_own on public.gif_favorites;
create policy gif_favorites_own on public.gif_favorites for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists gif_favorites_add on public.gif_favorites;
create policy gif_favorites_add on public.gif_favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and public.gif_favorite_count() < 500);
drop policy if exists gif_favorites_remove on public.gif_favorites;
create policy gif_favorites_remove on public.gif_favorites for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists not_banned on public.gif_favorites;
create policy not_banned on public.gif_favorites as restrictive for all to authenticated
  using ((select not public.is_banned())) with check ((select not public.is_banned()));
grant select, delete on public.gif_favorites to authenticated;
grant insert (url, preview, type, width, height, title) on public.gif_favorites to authenticated;

drop trigger if exists zz_block_banned on public.gif_favorites;
create trigger zz_block_banned before insert or update on public.gif_favorites
  for each row execute function public.block_banned_writes();
