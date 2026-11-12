-- aether.chat 1.2: server settings, the built-in bot, adjustable group DM size
--   * group DMs: the size limit is an app setting (app_config.group_dm_limit), editable by admins
--   * servers: verification level, welcome channel and message, rules
--   * the built-in bot ("Aether"): toggled per server; answers /commands and welcomes new members.
--     Bot messages have author_id null and is_bot = true; they're inserted through the same
--     path crossposts use, so they skip per-user checks (slow mode, AutoMod) but still need the
--     caller to be allowed to post in the channel.
-- Run after 011_moderation.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Group DM size
-- -------------------------------------------------------------------------------------------
insert into public.app_config (key, value) values ('group_dm_limit', '10'::jsonb) on conflict (key) do nothing;

create or replace function public.group_dm_limit()
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(2, least(10000, coalesce(
    case when jsonb_typeof(public.app_setting('group_dm_limit', '10'::jsonb)) = 'number'
         then (public.app_setting('group_dm_limit', '10'::jsonb))::text::numeric::integer end, 10)))
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

  insert into public.conversations (type, name, owner_id)
  values ('group', nullif(btrim(coalesce(p_name, '')), ''), v_me)
  returning id into v_conv;

  insert into public.conversation_members (conversation_id, user_id)
  select v_conv, u from unnest(array_append(v_ids, v_me)) as u;
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
  if (select count(*) from public.conversation_members where conversation_id = p_conversation_id) >= v_limit then
    raise exception 'Group DMs are limited to % people.', v_limit using errcode = 'P0001';
  end if;
  insert into public.conversation_members (conversation_id, user_id) values (p_conversation_id, p_user_id)
    on conflict do nothing;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 2. Server settings
-- -------------------------------------------------------------------------------------------
alter table public.servers
  add column if not exists verification_level text not null default 'none' check (verification_level in ('none', 'low', 'medium', 'high')),
  add column if not exists welcome_channel_id uuid references public.channels (id) on delete set null,
  add column if not exists welcome_message    text check (char_length(welcome_message) <= 500),
  add column if not exists rules              text check (char_length(rules) <= 4000),
  add column if not exists bot_enabled        boolean not null default false,
  add column if not exists bot_welcome        boolean not null default true;
grant update (verification_level, welcome_channel_id, welcome_message, rules, bot_enabled, bot_welcome) on public.servers to authenticated;

-- Joining: low = verified email, medium = also an account older than 5 minutes.
create or replace function public.enforce_server_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_level text; v_owner uuid; v_confirmed timestamptz; v_created timestamptz;
begin
  select s.verification_level, s.owner_id into v_level, v_owner from public.servers s where s.id = new.server_id;
  if coalesce(v_level, 'none') = 'none' or new.user_id = v_owner then return new; end if;
  select a.email_confirmed_at, a.created_at into v_confirmed, v_created from auth.users a where a.id = new.user_id;
  if v_confirmed is null then
    raise exception 'This server only lets in accounts with a verified email.' using errcode = '42501';
  end if;
  if v_level in ('medium', 'high') and v_created > now() - interval '5 minutes' then
    raise exception 'Your account needs to be at least 5 minutes old to join this server.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists server_members_verification on public.server_members;
create trigger server_members_verification before insert on public.server_members
  for each row execute function public.enforce_server_verification();

-- High: new members without a role wait 10 minutes before they can talk.
create or replace function public.enforce_new_member_wait()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_server uuid; v_level text; v_joined timestamptz;
begin
  if new.channel_id is null or current_setting('aether.crosspost', true) = '1' then return new; end if;
  select c.server_id into v_server from public.channels c where c.id = new.channel_id;
  select s.verification_level into v_level from public.servers s where s.id = v_server;
  if v_level is distinct from 'high' or public.has_server_permission(v_server, public.permission_bit('MANAGE_MESSAGES')) then return new; end if;
  if exists (select 1 from public.member_roles r where r.server_id = v_server and r.user_id = auth.uid()) then return new; end if;
  select m.joined_at into v_joined from public.server_members m where m.server_id = v_server and m.user_id = auth.uid();
  if v_joined is not null and v_joined > now() - interval '10 minutes' then
    raise exception 'New members can talk here 10 minutes after joining.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_zx_new_member_wait on public.messages;
create trigger messages_zx_new_member_wait before insert on public.messages
  for each row execute function public.enforce_new_member_wait();

-- -------------------------------------------------------------------------------------------
-- 3. The bot
-- -------------------------------------------------------------------------------------------
alter table public.messages
  add column if not exists is_bot         boolean not null default false,
  add column if not exists bot_invoker_id uuid references public.users (id) on delete set null,
  add column if not exists bot_command    text check (char_length(bot_command) <= 64);
-- Not in any INSERT/UPDATE grant: only bot_post() sets them.

create or replace function public.bot_post(p_channel_id uuid, p_content text, p_invoker uuid, p_command text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform set_config('aether.crosspost', '1', true);
  insert into public.messages (channel_id, author_id, content, is_bot, bot_invoker_id, bot_command)
  values (p_channel_id, null, left(p_content, 4000), true, p_invoker, p_command)
  returning id into v_id;
  perform set_config('aether.crosspost', '0', true);
  return v_id;
end;
$$;

-- Bot messages have no author: only mark the channel read for real authors.
create or replace function public.after_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.conversation_id is not null then
    update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
    update public.conversation_members
       set hidden = false,
           last_read_at = case when user_id = new.author_id then new.created_at else last_read_at end
     where conversation_id = new.conversation_id;
  else
    update public.channels set last_message_at = new.created_at where id = new.channel_id;
    if new.author_id is not null then
      insert into public.channel_read_states (user_id, channel_id, last_read_at)
      values (new.author_id, new.channel_id, new.created_at)
      on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
    end if;
  end if;
  return null;
end;
$$;

-- Welcome new members in the welcome channel.
create or replace function public.bot_welcome_member()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_srv public.servers; v_name text; v_text text;
begin
  select * into v_srv from public.servers where id = new.server_id;
  if not v_srv.bot_enabled or not v_srv.bot_welcome or v_srv.welcome_channel_id is null or new.user_id = v_srv.owner_id then return new; end if;
  if not exists (select 1 from public.channels c where c.id = v_srv.welcome_channel_id and c.server_id = v_srv.id and c.type = 'text') then return new; end if;
  select coalesce(u.display_name, u.username::text) into v_name from public.users u where u.id = new.user_id;
  v_text := coalesce(nullif(btrim(v_srv.welcome_message), ''), 'Welcome to **{server}**, {user}! Say hi 👋');
  v_text := replace(replace(v_text, '{user}', '**' || coalesce(v_name, 'someone') || '**'), '{server}', v_srv.name);
  perform public.bot_post(v_srv.welcome_channel_id, v_text, new.user_id, 'welcome');
  return new;
end;
$$;
drop trigger if exists server_members_bot_welcome on public.server_members;
create trigger server_members_bot_welcome after insert on public.server_members
  for each row execute function public.bot_welcome_member();

create or replace function public.bot_command(p_channel_id uuid, p_command text, p_args text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  v_srv    public.servers;
  v_cmd    text := lower(btrim(coalesce(p_command, '')));
  v_args   text := btrim(coalesce(p_args, ''));
  v_out    text;
  v_n      integer;
  v_m      integer;
  v_rolls  integer[];
  v_parts  text[];
  v_me     public.users;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select c.server_id into v_server from public.channels c where c.id = p_channel_id and c.type = 'text';
  if v_server is null then raise exception 'Bot commands work in server text channels.' using errcode = '22023'; end if;
  select * into v_srv from public.servers where id = v_server;
  if not v_srv.bot_enabled then
    raise exception 'The bot is off in this server. Someone with Manage Server can turn it on in Server Settings → Bot.' using errcode = '22023';
  end if;
  if not public.has_channel_permission(p_channel_id, public.permission_bit('SEND_MESSAGES')) then
    raise exception 'You can''t send messages here.' using errcode = '42501';
  end if;
  if public.is_timed_out(v_server) then raise exception 'You are timed out in this server.' using errcode = '42501'; end if;
  select * into v_me from public.users where id = auth.uid();

  case v_cmd
    when 'help' then
      v_out := E'**Commands**\n'
        || E'`/ping` check the bot is awake\n`/roll [2d6]` roll dice\n`/coinflip` heads or tails\n`/8ball question` ask the magic 8-ball\n'
        || E'`/choose a | b | c` pick one for you\n`/serverinfo` about this server\n`/userinfo` about you\n`/rules` the server rules\n'
        || E'**Moderators**\n`/say text` post as the bot\n`/purge 10` delete recent messages (up to 100)\n`/slowmode 10` set slow mode in seconds (0 = off)';
    when 'ping' then
      v_out := 'Pong! 🏓';
    when 'roll' then
      if v_args = '' then v_args := '1d6'; end if;
      if v_args !~* '^\d{0,2}d\d{1,4}$' then raise exception 'Use /roll NdM, for example /roll 2d6.' using errcode = '22023'; end if;
      v_n := coalesce(nullif(split_part(lower(v_args), 'd', 1), '')::integer, 1);
      v_m := split_part(lower(v_args), 'd', 2)::integer;
      if v_n < 1 or v_n > 20 or v_m < 2 or v_m > 1000 then raise exception 'Roll 1 to 20 dice with 2 to 1000 sides.' using errcode = '22023'; end if;
      select array_agg(1 + floor(random() * v_m)::integer) into v_rolls from generate_series(1, v_n);
      v_out := '🎲 ' || v_n || 'd' || v_m || ': **' || (select sum(x) from unnest(v_rolls) x) || '**'
        || case when v_n > 1 then ' (' || array_to_string(v_rolls, ' + ') || ')' else '' end;
    when 'coinflip', 'flip' then
      v_out := '🪙 ' || case when random() < 0.5 then '**Heads**' else '**Tails**' end;
    when '8ball' then
      if v_args = '' then raise exception 'Ask a question: /8ball will it rain?' using errcode = '22023'; end if;
      v_out := '🎱 *' || left(v_args, 200) || E'*\n**' || (array['It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.', 'Signs point to yes.',
        'Ask again later.', 'Better not tell you now.', 'Cannot predict now.', 'Don''t count on it.', 'My reply is no.', 'Very doubtful.', 'Outlook not so good.'])[1 + floor(random() * 12)::integer] || '**';
    when 'choose', 'pick' then
      v_parts := array(select btrim(x) from unnest(regexp_split_to_array(v_args, '\s*[|,]\s*')) x where btrim(x) <> '');
      if cardinality(v_parts) < 2 then raise exception 'Give at least two options: /choose pizza | tacos' using errcode = '22023'; end if;
      v_out := '🤔 I pick **' || left(v_parts[1 + floor(random() * cardinality(v_parts))::integer], 200) || '**';
    when 'serverinfo' then
      v_out := '**' || v_srv.name || E'**\n'
        || 'Owner: ' || coalesce((select '@' || u.username::text from public.users u where u.id = v_srv.owner_id), 'unknown') || E'\n'
        || 'Members: ' || (select count(*) from public.server_members m where m.server_id = v_server) || E'\n'
        || 'Channels: ' || (select count(*) from public.channels c where c.server_id = v_server and c.type <> 'category' and c.thread_parent_id is null) || E'\n'
        || 'Roles: ' || (select count(*) from public.server_roles r where r.server_id = v_server and not r.is_default) || E'\n'
        || 'Created: ' || to_char(v_srv.created_at, 'DD Mon YYYY')
        || case when v_srv.verification_level <> 'none' then E'\nVerification: ' || v_srv.verification_level else '' end;
    when 'userinfo' then
      v_out := '**' || coalesce(v_me.display_name, v_me.username::text) || '** (@' || v_me.username::text || E')\n'
        || 'Joined this server: ' || coalesce((select to_char(m.joined_at, 'DD Mon YYYY') from public.server_members m where m.server_id = v_server and m.user_id = v_me.id), 'unknown') || E'\n'
        || 'Account created: ' || to_char(v_me.created_at, 'DD Mon YYYY') || E'\n'
        || 'Roles: ' || coalesce((select string_agg(r.name, ', ' order by r.position desc) from public.member_roles mr join public.server_roles r on r.id = mr.role_id
                                   where mr.server_id = v_server and mr.user_id = v_me.id), 'none');
    when 'rules' then
      v_out := coalesce(E'**Server rules**\n' || nullif(btrim(v_srv.rules), ''), 'This server has no rules set yet.');
    when 'say' then
      if not public.has_channel_permission(p_channel_id, public.permission_bit('MANAGE_MESSAGES')) then
        raise exception '/say is for moderators (Manage Messages).' using errcode = '42501';
      end if;
      if v_args = '' then raise exception 'Say what? /say Hello everyone' using errcode = '22023'; end if;
      v_out := v_args;
    when 'purge', 'clear' then
      if not public.has_channel_permission(p_channel_id, public.permission_bit('MANAGE_MESSAGES')) then
        raise exception '/purge is for moderators (Manage Messages).' using errcode = '42501';
      end if;
      v_n := coalesce(nullif(regexp_replace(v_args, '\D', '', 'g'), '')::integer, 10);
      if v_n < 1 or v_n > 100 then raise exception 'Purge 1 to 100 messages.' using errcode = '22023'; end if;
      with doomed as (select m.id from public.messages m where m.channel_id = p_channel_id and not m.pinned order by m.created_at desc limit v_n)
      delete from public.messages m using doomed where m.id = doomed.id;
      get diagnostics v_n = row_count;
      perform public.write_audit(v_server, 'messages_purged', 'channel', p_channel_id, null, jsonb_build_object('count', v_n), null);
      v_out := '🧹 Deleted ' || v_n || ' message' || case when v_n = 1 then '' else 's' end || '.';
    when 'slowmode' then
      if not public.has_channel_permission(p_channel_id, public.permission_bit('MANAGE_CHANNELS')) then
        raise exception '/slowmode is for moderators (Manage Channels).' using errcode = '42501';
      end if;
      v_n := coalesce(nullif(regexp_replace(v_args, '\D', '', 'g'), '')::integer, 0);
      if v_n > 21600 then raise exception 'Slow mode can be up to 21600 seconds (6 hours).' using errcode = '22023'; end if;
      update public.channels set rate_limit_seconds = v_n where id = p_channel_id;
      v_out := case when v_n = 0 then '🐇 Slow mode is off.' else '🐢 Slow mode: one message every ' || v_n || ' second' || case when v_n = 1 then '' else 's' end || '.' end;
    else
      raise exception 'Unknown command /%. Try /help.', v_cmd using errcode = '22023';
  end case;

  return public.bot_post(p_channel_id, v_out, auth.uid(), v_cmd);
end;
$$;

revoke all on function public.group_dm_limit(), public.enforce_server_verification(), public.enforce_new_member_wait(),
                       public.bot_post(uuid, text, uuid, text), public.bot_welcome_member(), public.bot_command(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.group_dm_limit(), public.bot_command(uuid, text, text) to authenticated;

-- New tables since 011 get the ban guard too (none in this migration, kept for future copies):
-- create policy not_banned ... as restrictive; create trigger zz_block_banned ...
