-- Aether 1.7.1: server stickers. Run after 014_groups.sql.
-- Stickers are images (PNG, APNG, GIF, WebP up to 512 KB) a server uploads; members send them as a
-- message on their own. They're stored in the public "emojis" bucket under <server id>/stickers/.

create table if not exists public.server_stickers (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 30),
  description text check (description is null or char_length(description) <= 100),
  url         text not null check (url ~ '^https://'),
  created_by  uuid default auth.uid() references public.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists server_stickers_server on public.server_stickers (server_id);
alter table public.server_stickers enable row level security;

create or replace function public.server_sticker_count(p_server uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.server_stickers where server_id = p_server
$$;
revoke all on function public.server_sticker_count(uuid) from public, anon;
grant execute on function public.server_sticker_count(uuid) to authenticated;

-- Anyone signed in can see a sticker (so it renders wherever it was sent); MANAGE_EXPRESSIONS manages them.
drop policy if exists stickers_read on public.server_stickers;
create policy stickers_read on public.server_stickers for select to authenticated using (true);
drop policy if exists stickers_insert on public.server_stickers;
create policy stickers_insert on public.server_stickers for insert to authenticated
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS'))
              and public.server_sticker_count(server_id) < 60);
drop policy if exists stickers_update on public.server_stickers;
create policy stickers_update on public.server_stickers for update to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS')))
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS')));
drop policy if exists stickers_delete on public.server_stickers;
create policy stickers_delete on public.server_stickers for delete to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS')));
drop policy if exists not_banned on public.server_stickers;
create policy not_banned on public.server_stickers as restrictive for all to authenticated
  using ((select not public.is_banned())) with check ((select not public.is_banned()));

grant select, delete on public.server_stickers to authenticated;
grant insert (server_id, name, description, url) on public.server_stickers to authenticated;
grant update (name, description) on public.server_stickers to authenticated;

drop trigger if exists zz_block_banned on public.server_stickers;
create trigger zz_block_banned before insert or update on public.server_stickers
  for each row execute function public.block_banned_writes();
