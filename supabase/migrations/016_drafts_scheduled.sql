-- Aether 1.7.2: drafts that follow you between devices, and scheduled messages. Run after 015_stickers.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Drafts: one per person per chat. Only you can see yours.
-- -------------------------------------------------------------------------------------------
create table if not exists public.message_drafts (
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  scope_id   uuid not null,
  content    text not null check (char_length(content) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope_id)
);
alter table public.message_drafts enable row level security;
drop policy if exists drafts_own on public.message_drafts;
create policy drafts_own on public.message_drafts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.message_drafts to authenticated;

-- -------------------------------------------------------------------------------------------
-- 2. Scheduled messages: sent by the server at send_at, as you, with your permissions at that time.
-- -------------------------------------------------------------------------------------------
create table if not exists public.scheduled_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references public.users (id) on delete cascade,
  channel_id      uuid references public.channels (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  content         text not null default '' check (char_length(content) <= 4000),
  attachments     jsonb not null default '[]'::jsonb check (public.is_valid_attachments(attachments)),
  reply_to_id     uuid,
  send_at         timestamptz not null check (send_at > now() - interval '1 minute' and send_at < now() + interval '1 year'),
  failed          text,
  created_at      timestamptz not null default now(),
  check ((channel_id is null) <> (conversation_id is null)),
  check (char_length(btrim(content)) > 0 or jsonb_array_length(attachments) > 0)
);
create index if not exists scheduled_due on public.scheduled_messages (send_at) where failed is null;
alter table public.scheduled_messages enable row level security;

create or replace function public.scheduled_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.scheduled_messages where user_id = auth.uid() and failed is null
$$;
revoke all on function public.scheduled_count() from public, anon;
grant execute on function public.scheduled_count() to authenticated;

drop policy if exists scheduled_read on public.scheduled_messages;
create policy scheduled_read on public.scheduled_messages for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists scheduled_insert on public.scheduled_messages;
create policy scheduled_insert on public.scheduled_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.scheduled_count() < 50
              and (conversation_id is null or public.can_use_conversation(conversation_id))
              and (channel_id is null or public.has_channel_permission(channel_id, public.permission_bit('SEND_MESSAGES'))));
drop policy if exists scheduled_update on public.scheduled_messages;
create policy scheduled_update on public.scheduled_messages for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists scheduled_delete on public.scheduled_messages;
create policy scheduled_delete on public.scheduled_messages for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists not_banned on public.scheduled_messages;
create policy not_banned on public.scheduled_messages as restrictive for all to authenticated
  using ((select not public.is_banned())) with check ((select not public.is_banned()));
grant select, delete on public.scheduled_messages to authenticated;
grant insert (channel_id, conversation_id, content, attachments, reply_to_id, send_at) on public.scheduled_messages to authenticated;
grant update (content, send_at) on public.scheduled_messages to authenticated;

drop trigger if exists zz_block_banned on public.scheduled_messages;
create trigger zz_block_banned before insert or update on public.scheduled_messages
  for each row execute function public.block_banned_writes();

-- Sends everything that's due. Each message is inserted *as its author* (role authenticated with
-- their id), so channel permissions, slowmode, timeouts, AutoMod and bans apply exactly as if they
-- had pressed Send. If that fails, the row keeps the reason and the app shows it.
create or replace function public.send_due_scheduled()
returns integer language plpgsql set search_path = '' as $$
declare
  r record;
  sent integer := 0;
begin
  for r in
    select * from public.scheduled_messages where failed is null and send_at <= now() order by send_at limit 200 for update skip locked
  loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.messages (channel_id, conversation_id, content, attachments, reply_to_id)
      values (r.channel_id, r.conversation_id, r.content, r.attachments, r.reply_to_id);
      reset role;
      delete from public.scheduled_messages where id = r.id;
      sent := sent + 1;
    exception when others then
      reset role;
      update public.scheduled_messages set failed = left(sqlerrm, 300) where id = r.id;
    end;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return sent;
end;
$$;
revoke all on function public.send_due_scheduled() from public, anon, authenticated;

-- Every minute (the hosted database has pg_cron; local test databases may not).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'aether-send-scheduled';
    perform cron.schedule('aether-send-scheduled', '* * * * *', 'select public.send_due_scheduled()');
  end if;
end;
$$;
