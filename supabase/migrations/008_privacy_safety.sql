-- aether.chat Batch 6: accounts, privacy & safety (v0.9.0)
--   * privacy settings: who can DM you, who can send friend requests, message requests
--   * per-server profiles (avatar, banner, bio) on top of nicknames
--   * private notes and friend nicknames; mutual servers and friends
--   * AutoMod (keywords, links, mention spam, message spam) with block / timeout / alert
--   * reports and a moderator queue
--   * server ownership transfer, data export, account deletion
-- Run after 007_threads_forums_events.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Privacy settings and message requests
-- -------------------------------------------------------------------------------------------
create table if not exists public.privacy_settings (
  user_id               uuid primary key default auth.uid() references public.users (id) on delete cascade,
  -- 'servers': friends and people you share a server with (default); 'friends': friends only.
  dm_policy             text not null default 'servers' check (dm_policy in ('servers', 'friends')),
  -- 'everyone', 'mutuals' (share a server or a friend), 'nobody'.
  friend_request_policy text not null default 'everyone' check (friend_request_policy in ('everyone', 'mutuals', 'nobody')),
  -- New DMs from people who aren't your friends wait in "Message requests".
  message_requests      boolean not null default true,
  updated_at            timestamptz not null default now()
);
alter table public.privacy_settings enable row level security;
drop policy if exists privacy_settings_own on public.privacy_settings;
create policy privacy_settings_own on public.privacy_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.privacy_settings from anon;
grant select, insert, update on public.privacy_settings to authenticated;

create or replace function public.privacy_of(p_user uuid)
returns public.privacy_settings language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p from public.privacy_settings p where p.user_id = p_user),
    row(p_user, 'servers', 'everyone', true, now())::public.privacy_settings
  )
$$;

alter table public.conversation_members add column if not exists request_pending boolean not null default false;

-- Opening a DM honours the other person's privacy settings; strangers land in their requests.
create or replace function public.open_dm(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := auth.uid();
  v_key     text;
  v_conv    uuid;
  v_friends boolean;
  v_privacy public.privacy_settings;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_user_id = v_me then raise exception 'You cannot message yourself.' using errcode = 'P0001'; end if;
  if public.is_blocked_between(v_me, p_user_id) then
    raise exception 'You cannot message this user.' using errcode = '42501';
  end if;

  v_key := least(v_me, p_user_id)::text || ':' || greatest(v_me, p_user_id)::text;
  select id into v_conv from public.conversations where dm_key = v_key;

  if v_conv is null then
    v_friends := public.are_friends(v_me, p_user_id);
    v_privacy := public.privacy_of(p_user_id);
    if not v_friends and v_privacy.dm_policy = 'friends' then
      raise exception 'This user only accepts direct messages from friends.' using errcode = '42501';
    end if;
    if not (v_friends or public.shares_server(v_me, p_user_id)) then
      raise exception 'You can only message friends or people who share a server with you.' using errcode = '42501';
    end if;
    insert into public.conversations (type, dm_key) values ('dm', v_key)
      on conflict (dm_key) do nothing
      returning id into v_conv;
    if v_conv is null then
      select id into v_conv from public.conversations where dm_key = v_key;
    else
      insert into public.conversation_members (conversation_id, user_id, request_pending)
      values (v_conv, v_me, false), (v_conv, p_user_id, not v_friends and v_privacy.message_requests);
    end if;
  end if;

  update public.conversation_members set hidden = false where conversation_id = v_conv and user_id = v_me;
  return v_conv;
end;
$$;

-- Accept or ignore a message request.
create or replace function public.respond_message_request(p_conversation_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_members
     set request_pending = false, hidden = not p_accept
   where conversation_id = p_conversation_id and user_id = auth.uid() and request_pending;
  if not found then raise exception 'No pending request for that conversation.' using errcode = 'P0002'; end if;
end;
$$;

-- Sending in a DM also honours "friends only" (and blocks, as before).
create or replace function public.can_use_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_conversation_member(p_conversation_id)
     and not exists (
       select 1
         from public.conversations c
         join public.conversation_members other
           on other.conversation_id = c.id and other.user_id <> auth.uid()
        where c.id = p_conversation_id
          and c.type = 'dm'
          and (public.is_blocked_between(auth.uid(), other.user_id)
               or ((public.privacy_of(other.user_id)).dm_policy = 'friends' and not public.are_friends(auth.uid(), other.user_id)))
     )
$$;

-- Friend requests honour the target's setting. Accepting clears any pending message request.
create or replace function public.send_friend_request(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := auth.uid();
  v_target uuid;
  v_row    public.friendships%rowtype;
  v_policy text;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select u.id into v_target from public.users u where u.username = btrim(p_username)::extensions.citext;
  if v_target is null then raise exception 'No user with that username.' using errcode = 'P0002'; end if;
  if v_target = v_me then raise exception 'You cannot add yourself.' using errcode = 'P0001'; end if;
  if public.is_blocked_between(v_me, v_target) then
    raise exception 'You cannot send a friend request to this user.' using errcode = '42501';
  end if;

  select * into v_row from public.friendships f
   where least(f.requester_id, f.addressee_id) = least(v_me, v_target)
     and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_target)
   for update;

  if found then
    if v_row.status = 'accepted' then return 'already_friends'; end if;
    if v_row.requester_id = v_target then
      update public.friendships set status = 'accepted', accepted_at = now() where id = v_row.id;
      return 'accepted';
    end if;
    return 'already_sent';
  end if;

  v_policy := (public.privacy_of(v_target)).friend_request_policy;
  if v_policy = 'nobody' then
    raise exception 'This user isn''t accepting friend requests.' using errcode = '42501';
  end if;
  if v_policy = 'mutuals' and not public.shares_server(v_me, v_target) and not exists (
    select 1 from public.friendships a
      join public.friendships b on b.status = 'accepted'
       and (case when b.requester_id = v_target then b.addressee_id else b.requester_id end)
           = (case when a.requester_id = v_me then a.addressee_id else a.requester_id end)
       and v_target in (b.requester_id, b.addressee_id)
     where a.status = 'accepted' and v_me in (a.requester_id, a.addressee_id)
  ) then
    raise exception 'This user only accepts friend requests from people they share a server or a friend with.' using errcode = '42501';
  end if;

  insert into public.friendships (requester_id, addressee_id) values (v_me, v_target);
  return 'sent';
end;
$$;

create or replace function public.clear_requests_on_friendship()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'accepted' then
    update public.conversation_members cm set request_pending = false
      from public.conversations c
     where c.id = cm.conversation_id and c.type = 'dm'
       and c.dm_key = least(new.requester_id, new.addressee_id)::text || ':' || greatest(new.requester_id, new.addressee_id)::text;
  end if;
  return null;
end;
$$;
drop trigger if exists friendships_clear_requests on public.friendships;
create trigger friendships_clear_requests after insert or update on public.friendships
  for each row execute function public.clear_requests_on_friendship();

-- -------------------------------------------------------------------------------------------
-- 2. Per-server profiles
-- -------------------------------------------------------------------------------------------
alter table public.server_members
  add column if not exists avatar_url text check (avatar_url ~ '^https://'),
  add column if not exists banner_url text check (banner_url ~ '^https://'),
  add column if not exists bio        text check (char_length(bio) <= 1000);

create or replace function public.set_server_profile(p_server_id uuid, p_avatar_url text, p_banner_url text, p_bio text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.server_members
     set avatar_url = nullif(btrim(coalesce(p_avatar_url, '')), ''),
         banner_url = nullif(btrim(coalesce(p_banner_url, '')), ''),
         bio = nullif(left(btrim(coalesce(p_bio, '')), 1000), '')
   where server_id = p_server_id and user_id = auth.uid();
  if not found then raise exception 'You''re not in that server.' using errcode = '42501'; end if;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 3. Notes, friend nicknames, mutuals
-- -------------------------------------------------------------------------------------------
create table if not exists public.user_notes (
  owner_id   uuid not null default auth.uid() references public.users (id) on delete cascade,
  target_id  uuid not null references public.users (id) on delete cascade,
  note       text check (char_length(note) <= 256),
  nickname   text check (char_length(nickname) between 1 and 32),
  updated_at timestamptz not null default now(),
  primary key (owner_id, target_id)
);
alter table public.user_notes enable row level security;
drop policy if exists user_notes_own on public.user_notes;
create policy user_notes_own on public.user_notes for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.user_notes from anon;
grant select, insert, update, delete on public.user_notes to authenticated;

create or replace function public.mutual_servers(p_user_id uuid)
returns setof public.servers language sql stable security definer set search_path = '' as $$
  select s.* from public.servers s
   where exists (select 1 from public.server_members m where m.server_id = s.id and m.user_id = auth.uid())
     and exists (select 1 from public.server_members m where m.server_id = s.id and m.user_id = p_user_id)
   order by s.name
$$;

create or replace function public.mutual_friends(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select f.other from (
    select case when requester_id = auth.uid() then addressee_id else requester_id end as other
      from public.friendships where status = 'accepted' and auth.uid() in (requester_id, addressee_id)
  ) f
  where f.other <> p_user_id and public.are_friends(f.other, p_user_id)
$$;

-- -------------------------------------------------------------------------------------------
-- 4. Server ownership transfer
-- -------------------------------------------------------------------------------------------
create or replace function public.transfer_server(p_server_id uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if not exists (select 1 from public.servers where id = p_server_id and owner_id = auth.uid()) then
    raise exception 'Only the owner can transfer the server.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.server_members where server_id = p_server_id and user_id = p_new_owner) or p_new_owner = auth.uid() then
    raise exception 'Pick another member of the server.' using errcode = '22023';
  end if;
  perform set_config('aether.audit_skip', '1', true);
  update public.servers set owner_id = p_new_owner where id = p_server_id;
  perform set_config('aether.audit_skip', '0', true);
  select coalesce(u.display_name, u.username::text) into v_name from public.users u where u.id = p_new_owner;
  perform public.write_audit(p_server_id, 'server_transfer', 'member', p_new_owner, v_name);
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 5. AutoMod
-- -------------------------------------------------------------------------------------------
create table if not exists public.automod_rules (
  id               uuid primary key default gen_random_uuid(),
  server_id        uuid not null references public.servers (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  enabled          boolean not null default true,
  trigger          text not null check (trigger in ('keyword', 'link', 'mention', 'spam')),
  -- keyword: words or phrases ("*" = wildcard). link: unused.
  keywords         text[] not null default '{}' check (cardinality(keywords) <= 200),
  -- keyword: phrases that never trigger. link: allowed domains (e.g. youtube.com).
  allow_list       text[] not null default '{}' check (cardinality(allow_list) <= 100),
  mention_limit    integer not null default 10 check (mention_limit between 2 and 50),
  action           text not null default 'block' check (action in ('block', 'block_and_timeout', 'alert')),
  timeout_minutes  integer not null default 10 check (timeout_minutes between 1 and 40320),
  block_message    text check (char_length(block_message) <= 150),
  exempt_roles     uuid[] not null default '{}',
  exempt_channels  uuid[] not null default '{}',
  created_at       timestamptz not null default now()
);
create index if not exists automod_rules_server_idx on public.automod_rules (server_id) where enabled;

create table if not exists public.automod_events (
  id         bigint generated always as identity primary key,
  server_id  uuid not null references public.servers (id) on delete cascade,
  rule_id    uuid references public.automod_rules (id) on delete set null,
  rule_name  text not null,
  user_id    uuid references public.users (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete set null,
  content    text,
  matched    text,
  action     text not null,
  created_at timestamptz not null default now()
);
create index if not exists automod_events_server_idx on public.automod_events (server_id, created_at desc);
create index if not exists automod_events_user_idx on public.automod_events (user_id, created_at desc);

create or replace function public.automod_rule_count(p_server_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.automod_rules where server_id = p_server_id
$$;
revoke all on function public.automod_rule_count(uuid) from public, anon;
grant execute on function public.automod_rule_count(uuid) to authenticated;

alter table public.automod_rules enable row level security;
drop policy if exists automod_rules_manage on public.automod_rules;
create policy automod_rules_manage on public.automod_rules for all to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_SERVER')))
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_SERVER')));
drop policy if exists automod_rules_limit on public.automod_rules;
create policy automod_rules_limit on public.automod_rules as restrictive for insert to authenticated
  with check (public.automod_rule_count(server_id) < 15);
revoke all on public.automod_rules from anon;
grant select, insert, update, delete on public.automod_rules to authenticated;

alter table public.automod_events enable row level security;
drop policy if exists automod_events_read on public.automod_events;
create policy automod_events_read on public.automod_events for select to authenticated
  using (user_id = (select auth.uid()) or public.has_server_permission(server_id, public.permission_bit('MANAGE_MESSAGES')));
revoke all on public.automod_events from anon, authenticated;
grant select on public.automod_events to authenticated;

create or replace function public.automod_keyword_match(p_content text, p_keywords text[], p_allow text[])
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_text text := lower(coalesce(p_content, ''));
  v_kw   text;
  v_re   text;
begin
  -- remove allowed phrases first so "class" can be allowed while "ass" is blocked
  foreach v_kw in array coalesce(p_allow, '{}') loop
    if btrim(v_kw) <> '' then v_text := replace(v_text, lower(btrim(v_kw)), ' '); end if;
  end loop;
  foreach v_kw in array coalesce(p_keywords, '{}') loop
    v_kw := lower(btrim(v_kw));
    continue when v_kw = '';
    -- escape regex specials, then turn * into "any letters"
    v_re := regexp_replace(v_kw, '([.^$+?(){}\[\]|\\])', '\\\1', 'g');
    v_re := replace(v_re, '*', '\w*');
    if v_text ~ ('(^|\W)' || v_re || '($|\W)') then
      return v_kw;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.automod_link_match(p_content text, p_allow text[])
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_host  text;
  v_ok    boolean;
  v_allow text;
begin
  for v_host in
    select lower(m[1]) from regexp_matches(coalesce(p_content, ''), '(?:https?://|www\.)([a-z0-9.-]+\.[a-z]{2,})', 'gi') as m
  loop
    v_host := regexp_replace(v_host, '^www\.', '');
    v_ok := false;
    foreach v_allow in array coalesce(p_allow, '{}') loop
      v_allow := regexp_replace(lower(btrim(v_allow)), '^(https?://)?(www\.)?', '');
      if v_allow <> '' and (v_host = v_allow or v_host like '%.' || v_allow) then v_ok := true; exit; end if;
    end loop;
    if not v_ok then return v_host; end if;
  end loop;
  return null;
end;
$$;

-- Runs after validate_message_insert (trigger names sort alphabetically), so author and mentions are set.
create or replace function public.automod_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_server  uuid;
  v_rule    public.automod_rules;
  v_matched text;
  v_roles   uuid[];
  v_count   integer;
begin
  if new.channel_id is null or current_setting('aether.crosspost', true) = '1' then return new; end if;
  select coalesce(p.server_id, c.server_id) into v_server
    from public.channels c left join public.channels p on p.id = c.thread_parent_id where c.id = new.channel_id;
  if v_server is null or public.has_server_permission(v_server, public.permission_bit('MANAGE_SERVER')) then
    return new;  -- server managers (and the owner) are exempt
  end if;
  select coalesce(array_agg(role_id), '{}') into v_roles from public.member_roles where server_id = v_server and user_id = new.author_id;

  for v_rule in
    select * from public.automod_rules r
     where r.server_id = v_server and r.enabled
       and not (new.channel_id = any (r.exempt_channels))
       and not (r.exempt_roles && v_roles)
     order by r.created_at
  loop
    v_matched := null;
    if v_rule.trigger = 'keyword' then
      v_matched := public.automod_keyword_match(new.content, v_rule.keywords, v_rule.allow_list);
    elsif v_rule.trigger = 'link' then
      v_matched := public.automod_link_match(new.content, v_rule.allow_list);
    elsif v_rule.trigger = 'mention' then
      v_count := coalesce(cardinality(new.mentions), 0) + coalesce(cardinality(new.mention_roles), 0) + case when new.mention_everyone then 1 else 0 end;
      if v_count > v_rule.mention_limit then v_matched := v_count || ' mentions'; end if;
    elsif v_rule.trigger = 'spam' then
      select count(*) into v_count from public.messages m join public.channels c on c.id = m.channel_id
       where m.author_id = new.author_id and m.created_at > now() - interval '5 seconds'
         and (c.server_id = v_server);
      if v_count >= 5 then
        v_matched := 'flooding (5+ messages in 5 seconds)';
      elsif btrim(coalesce(new.content, '')) <> '' then
        select count(*) into v_count from public.messages m
         where m.author_id = new.author_id and m.content = new.content and m.created_at > now() - interval '30 seconds';
        if v_count >= 2 then v_matched := 'repeated message'; end if;
      end if;
    end if;

    if v_matched is not null then
      insert into public.automod_events (server_id, rule_id, rule_name, user_id, channel_id, content, matched, action)
      values (v_server, v_rule.id, v_rule.name, new.author_id, new.channel_id, left(new.content, 2000), v_matched, v_rule.action);
      if v_rule.action = 'block_and_timeout' then
        update public.server_members set timed_out_until = greatest(coalesce(timed_out_until, now()), now() + make_interval(mins => v_rule.timeout_minutes))
         where server_id = v_server and user_id = new.author_id;
      end if;
      if v_rule.action in ('block', 'block_and_timeout') then
        return null;  -- drop the message; the sender's app reads the event to explain why
      end if;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists messages_zz_automod on public.messages;
create trigger messages_zz_automod before insert on public.messages
  for each row execute function public.automod_message();

-- -------------------------------------------------------------------------------------------
-- 6. Reports
-- -------------------------------------------------------------------------------------------
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid default auth.uid() references public.users (id) on delete cascade,
  server_id      uuid references public.servers (id) on delete cascade,
  message_id     uuid references public.messages (id) on delete set null,
  target_user_id uuid references public.users (id) on delete cascade,
  reason         text not null check (reason in ('spam', 'harassment', 'hate', 'violence', 'nsfw', 'self_harm', 'scam', 'other')),
  details        text check (char_length(details) <= 1000),
  snapshot       jsonb,
  status         text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by    uuid references public.users (id) on delete set null,
  resolved_at    timestamptz,
  resolution     text check (char_length(resolution) <= 300),
  created_at     timestamptz not null default now(),
  check (message_id is not null or target_user_id is not null)
);
create index if not exists reports_server_idx on public.reports (server_id, status, created_at desc);

create or replace function public.prepare_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_msg public.messages;
begin
  new.reporter_id := auth.uid();
  new.status := 'open';
  new.resolved_by := null;
  new.resolved_at := null;
  if new.message_id is not null then
    if not public.can_read_message(new.message_id) then
      raise exception 'You can''t report a message you can''t see.' using errcode = '42501';
    end if;
    select * into v_msg from public.messages where id = new.message_id;
    new.target_user_id := v_msg.author_id;
    new.server_id := (select coalesce(p.server_id, c.server_id) from public.channels c
                        left join public.channels p on p.id = c.thread_parent_id where c.id = v_msg.channel_id);
    new.snapshot := jsonb_build_object('content', v_msg.content, 'attachments', v_msg.attachments, 'channel_id', v_msg.channel_id,
                                       'conversation_id', v_msg.conversation_id, 'created_at', v_msg.created_at);
  elsif new.server_id is not null and not public.is_server_member(new.server_id) then
    new.server_id := null;
  end if;
  if new.target_user_id = auth.uid() then raise exception 'You can''t report yourself.' using errcode = '22023'; end if;
  if exists (select 1 from public.reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '1 hour'
             having count(*) >= 20) then
    raise exception 'You''ve sent a lot of reports recently. Try again later.' using errcode = '53400';
  end if;
  return new;
end;
$$;
drop trigger if exists reports_prepare on public.reports;
create trigger reports_prepare before insert on public.reports for each row execute function public.prepare_report();

alter table public.reports enable row level security;
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (true);
drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated
  using (reporter_id = (select auth.uid())
         or (server_id is not null and public.has_server_permission(server_id, public.permission_bit('MANAGE_MESSAGES'))));
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
grant insert (server_id, message_id, target_user_id, reason, details) on public.reports to authenticated;

create or replace function public.resolve_report(p_report_id uuid, p_status text, p_resolution text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rep public.reports;
begin
  select * into v_rep from public.reports where id = p_report_id;
  if v_rep.id is null or v_rep.server_id is null
     or not public.has_server_permission(v_rep.server_id, public.permission_bit('MANAGE_MESSAGES')) then
    raise exception 'You can''t review this report.' using errcode = '42501';
  end if;
  if p_status not in ('open', 'resolved', 'dismissed') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  update public.reports
     set status = p_status, resolution = left(p_resolution, 300),
         resolved_by = case when p_status = 'open' then null else auth.uid() end,
         resolved_at = case when p_status = 'open' then null else now() end
   where id = p_report_id;
  perform public.write_audit(v_rep.server_id, 'report_' || p_status, 'member', v_rep.target_user_id, null, '{}'::jsonb, p_resolution);
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 7. Data export and account deletion
-- -------------------------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(u) from public.users u where u.id = auth.uid()),
    'privacy', (select to_jsonb(p) from public.privacy_settings p where p.user_id = auth.uid()),
    'notification_settings', (select coalesce(jsonb_agg(n), '[]') from public.notification_settings n where n.user_id = auth.uid()),
    'servers', (select coalesce(jsonb_agg(jsonb_build_object('server_id', m.server_id, 'server_name', s.name, 'owner', s.owner_id = auth.uid(),
                                                            'nickname', m.nickname, 'joined_at', m.joined_at, 'bio', m.bio)), '[]')
                  from public.server_members m join public.servers s on s.id = m.server_id where m.user_id = auth.uid()),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('user_id', case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
                                                             'status', f.status, 'since', coalesce(f.accepted_at, f.created_at))), '[]')
                  from public.friendships f where auth.uid() in (f.requester_id, f.addressee_id)),
    'blocked', (select coalesce(jsonb_agg(b.blocked_id), '[]') from public.user_blocks b where b.blocker_id = auth.uid()),
    'notes', (select coalesce(jsonb_agg(n), '[]') from public.user_notes n where n.owner_id = auth.uid()),
    'conversations', (select coalesce(jsonb_agg(jsonb_build_object('conversation_id', c.id, 'type', c.type, 'name', c.name, 'joined_at', cm.joined_at)), '[]')
                        from public.conversation_members cm join public.conversations c on c.id = cm.conversation_id where cm.user_id = auth.uid()),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'channel_id', m.channel_id, 'conversation_id', m.conversation_id,
                                                              'content', m.content, 'attachments', m.attachments, 'created_at', m.created_at,
                                                              'edited_at', m.edited_at) order by m.created_at), '[]')
                   from public.messages m where m.author_id = auth.uid()),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('message_id', r.message_id, 'emoji', r.emoji)), '[]')
                    from public.message_reactions r where r.user_id = auth.uid()),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason, 'details', r.details, 'status', r.status, 'created_at', r.created_at)), '[]')
                        from public.reports r where r.reporter_id = auth.uid()),
    'event_rsvps', (select coalesce(jsonb_agg(e.event_id), '[]') from public.event_rsvps e where e.user_id = auth.uid())
  )
$$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare v_owned text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select string_agg(s.name, ', ') into v_owned from public.servers s where s.owner_id = auth.uid();
  if v_owned is not null then
    raise exception 'Transfer or delete the servers you own first: %', v_owned using errcode = '42501';
  end if;
  -- Messages stay (attributed to "Deleted user") so conversations keep making sense.
  delete from auth.users where id = auth.uid();
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 8. Function privileges
-- -------------------------------------------------------------------------------------------
revoke all on function public.privacy_of(uuid), public.respond_message_request(uuid, boolean), public.set_server_profile(uuid, text, text, text),
                       public.mutual_servers(uuid), public.mutual_friends(uuid), public.transfer_server(uuid, uuid),
                       public.resolve_report(uuid, text, text), public.export_my_data(), public.delete_my_account()
  from public, anon;
grant execute on function public.respond_message_request(uuid, boolean), public.set_server_profile(uuid, text, text, text),
                          public.mutual_servers(uuid), public.mutual_friends(uuid), public.transfer_server(uuid, uuid),
                          public.resolve_report(uuid, text, text), public.export_my_data(), public.delete_my_account()
  to authenticated;

-- -------------------------------------------------------------------------------------------
-- 9. Unread summary: pending message requests don't badge
-- -------------------------------------------------------------------------------------------
create or replace function public.unread_summary()
returns table (
  scope_id        uuid,
  kind            text,
  server_id       uuid,
  last_message_at timestamptz,
  last_read_at    timestamptz,
  mention_count   integer
)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as id),
  my_roles as (select coalesce(array_agg(mr.role_id), '{}') as ids from public.member_roles mr where mr.user_id = (select id from me)),
  chans as (
    select c.id, c.server_id, c.last_message_at,
           coalesce(rs.last_read_at, case when c.thread_parent_id is not null then tm.joined_at end, sm.joined_at) as last_read_at,
           coalesce(cs.level, ps.level, ss.level, 'mentions') as level,
           coalesce(ss.suppress_everyone, false) as suppress_everyone
      from public.channels c
      join public.server_members sm on sm.server_id = c.server_id and sm.user_id = (select id from me)
      left join public.thread_members tm on tm.thread_id = c.id and tm.user_id = (select id from me)
      left join public.channel_read_states rs on rs.channel_id = c.id and rs.user_id = (select id from me)
      left join public.notification_settings cs on cs.user_id = (select id from me) and cs.scope_id = c.id
      left join public.notification_settings ps on ps.user_id = (select id from me) and ps.scope_id = c.thread_parent_id
      left join public.notification_settings ss on ss.user_id = (select id from me) and ss.scope_id = c.server_id
     where c.type = 'text'
       and (c.thread_parent_id is null or tm.user_id is not null)
       and public.has_channel_permission(c.id, public.permission_bit('VIEW_CHANNEL'))
  )
  select ch.id, 'channel', ch.server_id, ch.last_message_at, ch.last_read_at,
         case when ch.level = 'none' or ch.last_message_at is null or ch.last_message_at <= ch.last_read_at then 0 else (
           select least(count(*), 99)::integer from public.messages m
            where m.channel_id = ch.id and m.created_at > ch.last_read_at
              and m.author_id is distinct from (select id from me)
              and ((select id from me) = any (m.mentions)
                   or (m.mention_everyone and not ch.suppress_everyone)
                   or m.mention_roles && (select ids from my_roles))
         ) end
    from chans ch
  union all
  select cv.id, cv.type::text, null::uuid, cv.last_message_at, cm.last_read_at,
         case when cv.last_message_at <= cm.last_read_at or ns.level = 'none' then 0 else (
           select least(count(*), 99)::integer from public.messages m
            where m.conversation_id = cv.id and m.created_at > cm.last_read_at
              and m.author_id is distinct from (select id from me)
         ) end
    from public.conversations cv
    join public.conversation_members cm on cm.conversation_id = cv.id and cm.user_id = (select id from me) and not cm.request_pending
    left join public.notification_settings ns on ns.user_id = (select id from me) and ns.scope_id = cv.id
$$;
