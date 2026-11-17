-- 037: birthdays and shared lists (2.1).
--
-- Birthdays: month and day only (no year), in their own table so they never ride along with the
-- public profile row. Friends see them when you allow it; nobody else ever does.
--
-- Shared lists: checklists that live in a chat (a DM, group or channel). Anyone who can read the
-- chat sees them; anyone who can post there can add, tick and edit items.

-- -------------------------------------------------------------------------------------
-- Birthdays
-- -------------------------------------------------------------------------------------
create table if not exists public.birthdays (
  user_id    uuid primary key default auth.uid() references public.users (id) on delete cascade,
  month      smallint not null check (month between 1 and 12),
  day        smallint not null check (day between 1 and 31),
  visibility text not null default 'friends' check (visibility in ('friends', 'nobody')),
  check (day <= case when month = 2 then 29 when month in (4, 6, 9, 11) then 30 else 31 end)
);

alter table public.birthdays enable row level security;
drop policy if exists own on public.birthdays;
create policy own on public.birthdays for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.birthdays from anon, authenticated;
grant select, delete on public.birthdays to authenticated;
grant insert (month, day, visibility), update (month, day, visibility) on public.birthdays to authenticated;

-- Your friends' birthdays (the ones they share), for profiles and the "coming up" list.
create or replace function public.friend_birthdays()
returns table (user_id uuid, month smallint, day smallint)
language sql stable security definer set search_path = '' as $$
  select b.user_id, b.month, b.day
    from public.birthdays b
   where auth.uid() is not null
     and b.user_id <> auth.uid()
     and b.visibility = 'friends'
     and public.are_friends(auth.uid(), b.user_id)
     and not public.is_blocked_between(auth.uid(), b.user_id)
$$;
revoke all on function public.friend_birthdays() from public, anon;
grant execute on function public.friend_birthdays() to authenticated;

-- -------------------------------------------------------------------------------------
-- Shared lists
-- -------------------------------------------------------------------------------------
-- Can the current user post in this scope (conversation member, or SEND_MESSAGES in a channel)?
create or replace function public.can_write_scope(p_scope_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_scope_id is not null and (
    public.is_conversation_member(p_scope_id)
    or public.has_channel_permission(p_scope_id, public.permission_bit('SEND_MESSAGES'))
  )
$$;
revoke all on function public.can_write_scope(uuid) from public, anon;
grant execute on function public.can_write_scope(uuid) to authenticated;

create table if not exists public.shared_lists (
  id         uuid primary key default gen_random_uuid(),
  scope_id   uuid not null,
  title      text not null check (char_length(btrim(title)) between 1 and 80),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shared_lists_scope on public.shared_lists (scope_id, created_at);
create index if not exists shared_lists_created_by on public.shared_lists (created_by);

create table if not exists public.shared_list_items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.shared_lists (id) on delete cascade,
  scope_id   uuid not null,
  body       text not null check (char_length(btrim(body)) between 1 and 200),
  done       boolean not null default false,
  done_by    uuid references public.users (id) on delete set null,
  done_at    timestamptz,
  position   double precision not null default extract(epoch from clock_timestamp()),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shared_list_items_list on public.shared_list_items (list_id, position);
create index if not exists shared_list_items_scope on public.shared_list_items (scope_id);
create index if not exists shared_list_items_done_by on public.shared_list_items (done_by);
create index if not exists shared_list_items_created_by on public.shared_list_items (created_by);

-- Lists: who made it, and at most 50 per chat.
create or replace function public.shared_lists_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if (select count(*) from public.shared_lists l where l.scope_id = new.scope_id) >= 50 then
      raise exception 'This chat has 50 lists already. Delete one first.' using errcode = 'P0001';
    end if;
  else
    new.scope_id := old.scope_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.title := btrim(new.title);
  return new;
end;
$$;
drop trigger if exists shared_lists_before on public.shared_lists;
create trigger shared_lists_before before insert or update on public.shared_lists
  for each row execute function public.shared_lists_before();

-- Items: the chat comes from the list; who ticked it and when is recorded by the server.
create or replace function public.shared_list_items_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select l.scope_id into new.scope_id from public.shared_lists l where l.id = new.list_id;
    if new.scope_id is null then raise exception 'List not found.' using errcode = 'P0002'; end if;
    if (select count(*) from public.shared_list_items i where i.list_id = new.list_id) >= 200 then
      raise exception 'A list can have up to 200 items.' using errcode = 'P0001';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
    new.done := false;
  else
    new.list_id := old.list_id;
    new.scope_id := old.scope_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if tg_op = 'INSERT' or new.done is distinct from old.done then
    new.done_by := case when new.done then auth.uid() end;
    new.done_at := case when new.done then now() end;
  else
    new.done_by := old.done_by;
    new.done_at := old.done_at;
  end if;
  new.body := btrim(new.body);
  return new;
end;
$$;
drop trigger if exists shared_list_items_before on public.shared_list_items;
create trigger shared_list_items_before before insert or update on public.shared_list_items
  for each row execute function public.shared_list_items_before();
revoke all on function public.shared_lists_before(), public.shared_list_items_before() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['birthdays', 'shared_lists', 'shared_list_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
    execute format('drop policy if exists not_banned on public.%I', t);
    execute format('create policy not_banned on public.%I as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()))', t);
  end loop;
end;
$$;

drop policy if exists read on public.shared_lists;
create policy read on public.shared_lists for select to authenticated using (public.can_read_scope(scope_id));
drop policy if exists add on public.shared_lists;
create policy add on public.shared_lists for insert to authenticated with check (public.can_write_scope(scope_id));
drop policy if exists rename on public.shared_lists;
create policy rename on public.shared_lists for update to authenticated
  using (public.can_write_scope(scope_id)) with check (public.can_write_scope(scope_id));
-- Delete: whoever made it, or a moderator of the channel.
drop policy if exists remove on public.shared_lists;
create policy remove on public.shared_lists for delete to authenticated
  using (created_by = (select auth.uid()) or public.has_channel_permission(scope_id, public.permission_bit('MANAGE_MESSAGES')));
revoke all on public.shared_lists from anon, authenticated;
grant select, delete on public.shared_lists to authenticated;
grant insert (scope_id, title), update (title) on public.shared_lists to authenticated;

drop policy if exists read on public.shared_list_items;
create policy read on public.shared_list_items for select to authenticated using (public.can_read_scope(scope_id));
drop policy if exists write on public.shared_list_items;
create policy write on public.shared_list_items for insert to authenticated with check (public.can_write_scope(scope_id));
drop policy if exists edit on public.shared_list_items;
create policy edit on public.shared_list_items for update to authenticated
  using (public.can_write_scope(scope_id)) with check (public.can_write_scope(scope_id));
drop policy if exists remove on public.shared_list_items;
create policy remove on public.shared_list_items for delete to authenticated using (public.can_write_scope(scope_id));
revoke all on public.shared_list_items from anon, authenticated;
grant select, delete on public.shared_list_items to authenticated;
grant insert (list_id, body), update (body, done, position) on public.shared_list_items to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_lists') then
      alter publication supabase_realtime add table public.shared_lists;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_list_items') then
      alter publication supabase_realtime add table public.shared_list_items;
    end if;
  end if;
end;
$$;
