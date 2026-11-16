-- Aether 2.0: database side of the 2.0 features. Run after 029.
--   1. chat_folders + chat_prefs: pin, archive, put chats in folders, per-chat notification sound.
--   2. reminders: "remind me about this message" (the app shows them when they're due).
--   3. Disappearing messages: conversations.disappear_after; messages get expires_at, are hidden
--      once expired and deleted by a job.
--   4. Edit history: message_edits keeps what a message said before each edit. Readable by app
--      admins, and by server moderators (Manage Messages) for their own server's messages.
--   5. Privacy: who can add you to group chats (friends or nobody).
--   6. Quiet hours: no push notifications between two times of day.
--   7. bug_reports (+ private screenshot storage) and client_errors (crash and error tracking).
-- New functions are private by default (027): each one is granted explicitly.

-- ── 1. Folders, pins, archive, per-chat sound ────────────────────────────────────────────
create table if not exists public.chat_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 32),
  emoji      text check (char_length(emoji) <= 16),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists chat_folders_user on public.chat_folders (user_id, position);

create table if not exists public.chat_prefs (
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  scope_id   uuid not null,
  pinned_at  timestamptz,
  archived   boolean not null default false,
  folder_id  uuid references public.chat_folders (id) on delete set null,
  sound      text check (sound is null or sound ~ '^[a-z0-9-]{1,32}$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope_id)
);
create index if not exists chat_prefs_folder on public.chat_prefs (folder_id);

-- ── 2. Reminders ─────────────────────────────────────────────────────────────────────────
create table if not exists public.reminders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  scope_id   uuid,
  server_id  uuid references public.servers (id) on delete cascade,
  note       text check (char_length(note) <= 300),
  remind_at  timestamptz not null,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_due on public.reminders (user_id, remind_at) where done_at is null;
create index if not exists reminders_message on public.reminders (message_id);
create index if not exists reminders_server on public.reminders (server_id);

-- Owner-only tables.
do $$
declare t text;
begin
  foreach t in array array['chat_folders', 'chat_prefs', 'reminders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own on public.%I', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
    execute format('drop policy if exists not_banned on public.%I', t);
    execute format('create policy not_banned on public.%I as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;
-- Limits count through helper functions (a policy that queries its own table recurses).
create or replace function public.my_limit_count(p_what text)
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  return case p_what
    when 'folders' then (select count(*)::int from public.chat_folders where user_id = auth.uid())
    when 'reminders' then (select count(*)::int from public.reminders where user_id = auth.uid() and done_at is null)
    when 'bug_reports' then (select count(*)::int from public.bug_reports where user_id = auth.uid() and created_at > now() - interval '1 hour')
    else 0 end;
end;
$$;
revoke all on function public.my_limit_count(text) from public, anon;
grant execute on function public.my_limit_count(text) to authenticated;
drop policy if exists folder_limit on public.chat_folders;
create policy folder_limit on public.chat_folders as restrictive for insert to authenticated with check (public.my_limit_count('folders') < 20);
drop policy if exists reminder_limit on public.reminders;
create policy reminder_limit on public.reminders as restrictive for insert to authenticated with check (public.my_limit_count('reminders') < 200);

-- ── 3. Disappearing messages ─────────────────────────────────────────────────────────────
alter table public.conversations add column if not exists disappear_after integer check (disappear_after is null or disappear_after between 60 and 7776000);
alter table public.messages add column if not exists expires_at timestamptz;
create index if not exists messages_expires on public.messages (expires_at) where expires_at is not null;

create or replace function public.set_message_expiry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_after integer;
begin
  if new.conversation_id is null then return new; end if;
  select c.disappear_after into v_after from public.conversations c where c.id = new.conversation_id;
  if v_after is not null then new.expires_at := now() + make_interval(secs => v_after); end if;
  return new;
end;
$$;
drop trigger if exists messages_set_expiry on public.messages;
create trigger messages_set_expiry before insert on public.messages for each row execute function public.set_message_expiry();

-- Any member turns it on (p_seconds) or off (null). Applies to messages sent from now on.
create or replace function public.set_disappearing(p_conversation_id uuid, p_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'You''re not in this chat.' using errcode = '42501';
  end if;
  update public.conversations set disappear_after = p_seconds where id = p_conversation_id;
end;
$$;

-- Expired messages are hidden at once and deleted by a job.
drop policy if exists not_expired on public.messages;
create policy not_expired on public.messages as restrictive for select to authenticated using (expires_at is null or expires_at > now());
create or replace function public.purge_expired_messages()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.messages where expires_at is not null and expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 4. Edit history ──────────────────────────────────────────────────────────────────────
create table if not exists public.message_edits (
  id          bigint generated always as identity primary key,
  message_id  uuid not null references public.messages (id) on delete cascade,
  old_content text not null,
  editor_id   uuid references public.users (id) on delete set null,
  edited_at   timestamptz not null default now()
);
create index if not exists message_edits_message on public.message_edits (message_id, edited_at);
create index if not exists message_edits_editor on public.message_edits (editor_id);
alter table public.message_edits enable row level security;
drop policy if exists edits_admins_mods on public.message_edits;
create policy edits_admins_mods on public.message_edits for select to authenticated using (
  public.is_app_admin()
  or exists (select 1 from public.messages m where m.id = message_edits.message_id and m.channel_id is not null
             and public.has_channel_permission(m.channel_id, public.permission_bit('MANAGE_MESSAGES')))
);
drop policy if exists mfa_required on public.message_edits;
create policy mfa_required on public.message_edits as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
revoke all on public.message_edits from anon, authenticated;
grant select on public.message_edits to authenticated;

create or replace function public.record_message_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.content is distinct from new.content and coalesce(old.content, '') <> '' then
    insert into public.message_edits (message_id, old_content, editor_id) values (old.id, old.content, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists messages_record_edit on public.messages;
create trigger messages_record_edit after update of content on public.messages for each row execute function public.record_message_edit();

-- ── 5. Privacy: who can add you to group chats ───────────────────────────────────────────
alter table public.privacy_settings add column if not exists group_add_policy text not null default 'friends' check (group_add_policy in ('friends', 'nobody'));
grant insert (group_add_policy), update (group_add_policy) on public.privacy_settings to authenticated;

-- The default row for people who never saved privacy settings now has the new column too.
create or replace function public.privacy_of(p_user uuid)
returns public.privacy_settings language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p from public.privacy_settings p where p.user_id = p_user),
    row(p_user, 'everyone', 'everyone', true, now(), 'friends')::public.privacy_settings
  )
$$;

create or replace function public.can_add_to_group(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.group_add_policy from public.privacy_settings p where p.user_id = p_user), 'friends') <> 'nobody'
$$;

create or replace function public.create_group_dm(p_user_ids uuid[], p_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := auth.uid();
  v_ids   uuid[];
  v_conv  uuid;
  v_limit integer := public.group_dm_limit();
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct u), '{}') into v_ids from unnest(p_user_ids) as u where u <> v_me;
  if cardinality(v_ids) < 1 then raise exception 'Pick at least one friend.' using errcode = 'P0001'; end if;
  if cardinality(v_ids) + 1 > v_limit then raise exception 'Group DMs are limited to % people.', v_limit using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(v_ids) as u where not public.are_friends(v_me, u)) then
    raise exception 'You can only add friends to a group.' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(v_ids) as u where not public.can_add_to_group(u)) then
    raise exception 'Someone you picked doesn''t allow being added to group chats.' using errcode = '42501';
  end if;
  insert into public.conversations (type, name, owner_id) values ('group', nullif(btrim(coalesce(p_name, '')), ''), v_me) returning id into v_conv;
  insert into public.conversation_members (conversation_id, user_id) select v_conv, u from unnest(array_append(v_ids, v_me)) as u;
  return v_conv;
end;
$$;

create or replace function public.add_group_member(p_conversation_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_type  public.conversation_type;
  v_limit integer := public.group_dm_limit();
begin
  select type into v_type from public.conversations where id = p_conversation_id;
  if v_type is distinct from 'group' or not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a group you are in.' using errcode = '42501';
  end if;
  if not public.are_friends(auth.uid(), p_user_id) then
    raise exception 'You can only add friends to a group.' using errcode = '42501';
  end if;
  if not public.can_add_to_group(p_user_id) then
    raise exception 'They don''t allow being added to group chats.' using errcode = '42501';
  end if;
  if (select count(*) from public.conversation_members where conversation_id = p_conversation_id) >= v_limit then
    raise exception 'Group DMs are limited to % people.', v_limit using errcode = 'P0001';
  end if;
  insert into public.conversation_members (conversation_id, user_id) values (p_conversation_id, p_user_id) on conflict do nothing;
end;
$$;

-- ── 6. Quiet hours ───────────────────────────────────────────────────────────────────────
alter table public.users
  add column if not exists quiet_start time,
  add column if not exists quiet_end   time,
  add column if not exists quiet_tz    text check (quiet_tz is null or char_length(quiet_tz) <= 64);
grant update (quiet_start, quiet_end, quiet_tz) on public.users to authenticated;

-- Is it quiet hours for this person right now? (Used by the push function.)
create or replace function public.in_quiet_hours(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_s time; v_e time; v_tz text; v_now time;
begin
  select quiet_start, quiet_end, coalesce(quiet_tz, 'UTC') into v_s, v_e, v_tz from public.users where id = p_user;
  if v_s is null or v_e is null or v_s = v_e then return false; end if;
  begin
    v_now := (now() at time zone v_tz)::time;
  exception when others then
    v_now := (now() at time zone 'UTC')::time;
  end;
  return case when v_s < v_e then v_now >= v_s and v_now < v_e else v_now >= v_s or v_now < v_e end;
end;
$$;

-- ── 7. Bug reports and error tracking ────────────────────────────────────────────────────
create table if not exists public.bug_reports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid default auth.uid() references public.users (id) on delete set null,
  description     text not null check (char_length(btrim(description)) between 5 and 4000),
  screenshot_path text check (char_length(screenshot_path) <= 300),
  app_version     text check (char_length(app_version) <= 32),
  platform        text check (char_length(platform) <= 64),
  user_agent      text check (char_length(user_agent) <= 400),
  page            text check (char_length(page) <= 200),
  status          text not null default 'open' check (status in ('open', 'fixed', 'closed')),
  created_at      timestamptz not null default now()
);
create index if not exists bug_reports_status on public.bug_reports (status, created_at desc);
create index if not exists bug_reports_user on public.bug_reports (user_id);
alter table public.bug_reports enable row level security;
drop policy if exists bug_insert_own on public.bug_reports;
create policy bug_insert_own on public.bug_reports for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists bug_read on public.bug_reports;
create policy bug_read on public.bug_reports for select to authenticated using (user_id = (select auth.uid()) or public.is_app_admin());
drop policy if exists bug_admin_update on public.bug_reports;
create policy bug_admin_update on public.bug_reports for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
drop policy if exists bug_limit on public.bug_reports;
create policy bug_limit on public.bug_reports as restrictive for insert to authenticated with check (public.my_limit_count('bug_reports') < 10);
drop policy if exists mfa_required on public.bug_reports;
create policy mfa_required on public.bug_reports as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
revoke all on public.bug_reports from anon, authenticated;
grant select on public.bug_reports to authenticated;
grant insert (description, screenshot_path, app_version, platform, user_agent, page) on public.bug_reports to authenticated;
grant update (status) on public.bug_reports to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('bug-reports', 'bug-reports', false, 5242880)
on conflict (id) do nothing;
drop policy if exists "storage: bug screenshots upload own" on storage.objects;
create policy "storage: bug screenshots upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'bug-reports' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "storage: bug screenshots read own or admin" on storage.objects;
create policy "storage: bug screenshots read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'bug-reports' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_app_admin()));

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  fingerprint text not null check (char_length(fingerprint) <= 64),
  message     text not null check (char_length(message) <= 500),
  stack       text check (char_length(stack) <= 4000),
  app_version text check (char_length(app_version) <= 32),
  platform    text check (char_length(platform) <= 64),
  page        text check (char_length(page) <= 200),
  count       integer not null default 1,
  users       uuid[] not null default '{}',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (fingerprint, app_version)
);
alter table public.client_errors enable row level security;
drop policy if exists errors_admin_read on public.client_errors;
create policy errors_admin_read on public.client_errors for select to authenticated using (public.is_app_admin());
drop policy if exists mfa_required on public.client_errors;
create policy mfa_required on public.client_errors as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
revoke all on public.client_errors from anon, authenticated;
grant select on public.client_errors to authenticated;

-- The app reports an error: grouped by fingerprint and version, counted, at most 30 new kinds an hour.
create or replace function public.log_client_error(p_fingerprint text, p_message text, p_stack text, p_version text, p_platform text, p_page text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if not exists (select 1 from public.client_errors where fingerprint = left(p_fingerprint, 64) and app_version = left(p_version, 32))
     and (select count(*) from public.client_errors where first_seen > now() - interval '1 hour') >= 30 then
    return;
  end if;
  insert into public.client_errors (fingerprint, message, stack, app_version, platform, page, users)
  values (left(p_fingerprint, 64), left(p_message, 500), left(p_stack, 4000), left(p_version, 32), left(p_platform, 64), left(p_page, 200), array[auth.uid()])
  on conflict (fingerprint, app_version) do update
    set count = public.client_errors.count + 1,
        last_seen = now(),
        users = case when auth.uid() = any (public.client_errors.users) or cardinality(public.client_errors.users) >= 50
                     then public.client_errors.users else public.client_errors.users || auth.uid() end;
end;
$$;

-- ── Grants and jobs ──────────────────────────────────────────────────────────────────────
revoke all on function public.set_message_expiry(), public.record_message_edit(), public.purge_expired_messages(), public.in_quiet_hours(uuid),
                       public.can_add_to_group(uuid) from public, anon, authenticated;
revoke all on function public.set_disappearing(uuid, integer), public.log_client_error(text, text, text, text, text, text) from public, anon;
grant execute on function public.set_disappearing(uuid, integer), public.log_client_error(text, text, text, text, text, text) to authenticated;
grant execute on function public.in_quiet_hours(uuid) to service_role;
grant execute on function public.create_group_dm(uuid[], text), public.add_group_member(uuid, uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'aether-purge-expired-messages';
    perform cron.schedule('aether-purge-expired-messages', '*/5 * * * *', 'select public.purge_expired_messages()');
  end if;
end;
$$;
