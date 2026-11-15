-- Aether 1.8.0: saved messages and read receipts. Run after 017_gif_favorites.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Saved messages: your private bookmarks. You can only save messages you can see.
-- -------------------------------------------------------------------------------------------
create table if not exists public.saved_messages (
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  saved_at   timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists saved_messages_recent on public.saved_messages (user_id, saved_at desc);
alter table public.saved_messages enable row level security;

create or replace function public.saved_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.saved_messages where user_id = auth.uid()
$$;
revoke all on function public.saved_count() from public, anon;
grant execute on function public.saved_count() to authenticated;

drop policy if exists saved_own on public.saved_messages;
create policy saved_own on public.saved_messages for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists saved_add on public.saved_messages;
-- The message check runs with your own permissions, so only messages you can read can be saved.
create policy saved_add on public.saved_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.saved_count() < 1000
              and exists (select 1 from public.messages m where m.id = message_id));
drop policy if exists saved_remove on public.saved_messages;
create policy saved_remove on public.saved_messages for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists not_banned on public.saved_messages;
create policy not_banned on public.saved_messages as restrictive for all to authenticated
  using ((select not public.is_banned())) with check ((select not public.is_banned()));
grant select, delete on public.saved_messages to authenticated;
grant insert (message_id) on public.saved_messages to authenticated;

-- -------------------------------------------------------------------------------------------
-- 2. Read receipts ("Seen") in DMs and groups. Two-way: if you turn them off, nobody sees when
--    you've read their messages and you don't see theirs either.
-- -------------------------------------------------------------------------------------------
alter table public.users add column if not exists read_receipts boolean not null default true;
grant update (read_receipts) on public.users to authenticated;

create or replace function public.conversation_reads(p_conversation_id uuid)
returns table (user_id uuid, last_read_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select cm.user_id, cm.last_read_at
    from public.conversation_members cm
    join public.users u on u.id = cm.user_id
   where cm.conversation_id = p_conversation_id
     and cm.user_id <> auth.uid()
     and u.read_receipts
     and exists (select 1 from public.conversation_members me
                  where me.conversation_id = p_conversation_id and me.user_id = auth.uid())
     and (select r.read_receipts from public.users r where r.id = auth.uid())
$$;
revoke all on function public.conversation_reads(uuid) from public, anon;
grant execute on function public.conversation_reads(uuid) to authenticated;
