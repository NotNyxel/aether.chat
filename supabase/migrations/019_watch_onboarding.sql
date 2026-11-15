-- Aether 1.8.1: watch together and server onboarding. Run after 018_saved_receipts.sql.

-- -------------------------------------------------------------------------------------------
-- Helpers: can I read / post in this chat (a channel or a DM/group)?
-- -------------------------------------------------------------------------------------------
create or replace function public.scope_can_read(p_scope uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.conversations c where c.id = p_scope)
      then exists (select 1 from public.conversation_members m where m.conversation_id = p_scope and m.user_id = auth.uid())
    else public.has_channel_permission(p_scope, public.permission_bit('VIEW_CHANNEL'))
  end
$$;
create or replace function public.scope_can_post(p_scope uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.conversations c where c.id = p_scope) then public.can_use_conversation(p_scope)
    else public.has_channel_permission(p_scope, public.permission_bit('SEND_MESSAGES'))
  end
$$;
revoke all on function public.scope_can_read(uuid), public.scope_can_post(uuid) from public, anon;
grant execute on function public.scope_can_read(uuid), public.scope_can_post(uuid) to authenticated;

-- -------------------------------------------------------------------------------------------
-- 1. Watch together: one shared YouTube player per chat. Anyone who can post can start it,
--    change the video, play, pause or seek; everyone watching follows.
-- -------------------------------------------------------------------------------------------
create table if not exists public.watch_parties (
  scope_id   uuid primary key,
  video_id   text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title      text check (title is null or char_length(title) <= 200),
  playing    boolean not null default true,
  position   double precision not null default 0 check (position >= 0),
  started_by uuid default auth.uid() references public.users (id) on delete set null,
  updated_by uuid default auth.uid() references public.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.watch_parties enable row level security;

create or replace function public.watch_party_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists watch_party_touch on public.watch_parties;
create trigger watch_party_touch before insert or update on public.watch_parties for each row execute function public.watch_party_touch();

drop policy if exists watch_read on public.watch_parties;
create policy watch_read on public.watch_parties for select to authenticated using (public.scope_can_read(scope_id));
drop policy if exists watch_start on public.watch_parties;
create policy watch_start on public.watch_parties for insert to authenticated with check (public.scope_can_post(scope_id));
drop policy if exists watch_control on public.watch_parties;
create policy watch_control on public.watch_parties for update to authenticated using (public.scope_can_post(scope_id)) with check (public.scope_can_post(scope_id));
drop policy if exists watch_stop on public.watch_parties;
create policy watch_stop on public.watch_parties for delete to authenticated using (public.scope_can_post(scope_id));
drop policy if exists not_banned on public.watch_parties;
create policy not_banned on public.watch_parties as restrictive for all to authenticated
  using ((select not public.is_banned())) with check ((select not public.is_banned()));
grant select, delete on public.watch_parties to authenticated;
grant insert (scope_id, video_id, title, playing, position) on public.watch_parties to authenticated;
grant update (video_id, title, playing, position) on public.watch_parties to authenticated;
drop trigger if exists zz_block_banned on public.watch_parties;
create trigger zz_block_banned before insert or update on public.watch_parties for each row execute function public.block_banned_writes();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'watch_parties') then
    alter publication supabase_realtime add table public.watch_parties;
  end if;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 2. Server onboarding: a welcome screen for new members with the rules to accept and roles
--    they can pick themselves (games, pronouns, which pings they want).
-- -------------------------------------------------------------------------------------------
alter table public.servers add column if not exists onboarding_enabled boolean not null default false;
alter table public.servers add column if not exists onboarding_prompt text check (onboarding_prompt is null or char_length(onboarding_prompt) <= 200);
alter table public.server_roles add column if not exists self_assignable boolean not null default false;
alter table public.server_members add column if not exists onboarded_at timestamptz;
grant update (onboarding_enabled, onboarding_prompt) on public.servers to authenticated;
grant update (self_assignable) on public.server_roles to authenticated;

-- Finish (or redo) onboarding: accept the rules and set your self-assignable roles. Only roles the
-- server marked "members can pick" are touched; your other roles stay as they are.
create or replace function public.complete_onboarding(p_server_id uuid, p_role_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.server_members where server_id = p_server_id and user_id = auth.uid()) then
    raise exception 'You''re not in this server.' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_role_ids, '{}')) r(id)
              where not exists (select 1 from public.server_roles sr where sr.id = r.id and sr.server_id = p_server_id and sr.self_assignable and not sr.is_default)) then
    raise exception 'One of those roles can''t be picked.' using errcode = '22023';
  end if;
  delete from public.member_roles mr using public.server_roles sr
   where mr.role_id = sr.id and sr.server_id = p_server_id and sr.self_assignable
     and mr.user_id = auth.uid() and not (mr.role_id = any (coalesce(p_role_ids, '{}')));
  insert into public.member_roles (server_id, user_id, role_id)
  select p_server_id, auth.uid(), r.id from unnest(coalesce(p_role_ids, '{}')) r(id)
  on conflict do nothing;
  update public.server_members set onboarded_at = now() where server_id = p_server_id and user_id = auth.uid();
end;
$$;
revoke all on function public.complete_onboarding(uuid, uuid[]) from public, anon;
grant execute on function public.complete_onboarding(uuid, uuid[]) to authenticated;
