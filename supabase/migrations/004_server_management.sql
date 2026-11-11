-- =====================================================================================
-- aether.chat migration 004: Batch 2 "Server management" (v0.5.0)
--   new permissions (MANAGE_NICKNAMES, MODERATE_MEMBERS, VIEW_AUDIT_LOG) · member timeouts
--   @role mentions · NSFW channels · channel & role reordering · kick with reason
--   custom invite codes · audit log (trigger-written, tamper-proof)
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Permission catalogue (mirrored in src/lib/permissions.ts)
-- -------------------------------------------------------------------------------------
create or replace function public.permission_bit(p_name text)
returns bigint language sql immutable parallel safe set search_path = '' as $$
  select case p_name
    when 'VIEW_CHANNEL'     then 1::bigint << 0
    when 'SEND_MESSAGES'    then 1::bigint << 1
    when 'ATTACH_FILES'     then 1::bigint << 2
    when 'MANAGE_MESSAGES'  then 1::bigint << 3
    when 'MENTION_EVERYONE' then 1::bigint << 4
    when 'CONNECT'          then 1::bigint << 5
    when 'SPEAK'            then 1::bigint << 6
    when 'STREAM'           then 1::bigint << 7
    when 'MUTE_MEMBERS'     then 1::bigint << 8
    when 'DEAFEN_MEMBERS'   then 1::bigint << 9
    when 'MOVE_MEMBERS'     then 1::bigint << 10
    when 'MANAGE_CHANNELS'  then 1::bigint << 11
    when 'MANAGE_ROLES'     then 1::bigint << 12
    when 'MANAGE_SERVER'    then 1::bigint << 13
    when 'CREATE_INVITE'    then 1::bigint << 14
    when 'KICK_MEMBERS'     then 1::bigint << 15
    when 'BAN_MEMBERS'      then 1::bigint << 16
    when 'CHANGE_NICKNAME'  then 1::bigint << 17
    when 'ADMINISTRATOR'    then 1::bigint << 18
    when 'MANAGE_NICKNAMES' then 1::bigint << 19
    when 'MODERATE_MEMBERS' then 1::bigint << 20
    when 'VIEW_AUDIT_LOG'   then 1::bigint << 21
  end
$$;

create or replace function public.all_permissions()
returns bigint language sql immutable parallel safe set search_path = '' as $$ select (1::bigint << 22) - 1 $$;

-- -------------------------------------------------------------------------------------
-- 2. Columns
-- -------------------------------------------------------------------------------------
alter table public.server_members add column timed_out_until timestamptz;
alter table public.channels add column nsfw boolean not null default false;
alter table public.messages add column mention_roles uuid[] not null default '{}';
create index messages_mention_roles_idx on public.messages using gin (mention_roles);

grant insert (nsfw) on public.channels to authenticated;
grant update (nsfw) on public.channels to authenticated;
grant insert (code) on public.server_invites to authenticated;

-- -------------------------------------------------------------------------------------
-- 3. Helpers
-- -------------------------------------------------------------------------------------
create or replace function public.is_timed_out(p_server_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.server_members m
     where m.server_id = p_server_id and m.user_id = p_user_id and m.timed_out_until > now()
  )
$$;

-- Role ids mentioned as <@&role-uuid> that the author may ping in this channel:
-- mentionable roles, or any role when the author has MENTION_EVERYONE.
create or replace function public.extract_role_mentions(p_content text, p_channel_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct r.id), '{}')
    from regexp_matches(coalesce(p_content, ''), '<@&([0-9a-fA-F-]{36})>', 'g') as m(parts)
    join public.server_roles r on r.id = public.try_uuid(m.parts[1])
    join public.channels c on c.id = p_channel_id and c.server_id = r.server_id
   where not r.is_default
     and (r.mentionable or public.has_channel_permission(p_channel_id, public.permission_bit('MENTION_EVERYONE')))
$$;

-- Changed columns between two rows (ignores bookkeeping columns).
create or replace function public.jsonb_diff(p_old jsonb, p_new jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', p_old -> k, 'new', p_new -> k)), '{}'::jsonb)
    from jsonb_object_keys(p_new) as k
   where k not in ('updated_at', 'last_message_at', 'created_at')
     and (p_old -> k) is distinct from (p_new -> k)
$$;

-- -------------------------------------------------------------------------------------
-- 4. Timeout & role-mention enforcement (replace 003 versions)
-- -------------------------------------------------------------------------------------
create or replace function public.validate_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_type      public.channel_type;
  v_rate      integer;
  v_server    uuid;
  v_last_sent timestamptz;
  v_hours     integer;
  v_src       public.messages%rowtype;
  v_src_id    uuid;
begin
  new.author_id  := auth.uid();
  new.created_at := now();
  new.edited_at  := null;
  new.pinned     := false;
  new.pinned_at  := null;
  new.pinned_by  := null;

  if new.channel_id is not null then
    select c.type, c.rate_limit_seconds, c.server_id into v_type, v_rate, v_server from public.channels c where c.id = new.channel_id;
    if v_type is distinct from 'text' then
      raise exception 'messages can only be sent to text channels' using errcode = '23514';
    end if;
    if public.is_timed_out(v_server) then
      raise exception 'You are timed out in this server.' using errcode = '42501';
    end if;
    if v_rate > 0 and not public.has_channel_permission(new.channel_id, public.permission_bit('MANAGE_MESSAGES')) then
      select max(m.created_at) into v_last_sent
        from public.messages m where m.channel_id = new.channel_id and m.author_id = new.author_id;
      if v_last_sent is not null and v_last_sent > now() - make_interval(secs => v_rate) then
        raise exception 'slow mode: wait % seconds between messages', v_rate using errcode = 'P0001';
      end if;
    end if;
  else
    if not public.can_use_conversation(new.conversation_id) then
      raise exception 'You cannot message this conversation.' using errcode = '42501';
    end if;
  end if;

  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
     where m.id = new.reply_to_id
       and m.channel_id is not distinct from new.channel_id
       and m.conversation_id is not distinct from new.conversation_id
  ) then
    raise exception 'reply target must be in the same channel' using errcode = '23514';
  end if;

  if new.poll is not null then
    v_hours := coalesce((new.poll ->> 'duration_hours')::integer, 24);
    if v_hours not in (1, 4, 8, 24, 72, 168) then
      raise exception 'Poll duration must be 1, 4, 8, 24, 72 or 168 hours.' using errcode = '23514';
    end if;
    new.poll := jsonb_build_object(
      'question', btrim(coalesce(new.poll ->> 'question', '')),
      'options', coalesce((
        select jsonb_agg(jsonb_build_object('text', btrim(coalesce(o.item ->> 'text', '')), 'emoji', nullif(o.item ->> 'emoji', '')) order by o.idx)
          from jsonb_array_elements(case when jsonb_typeof(new.poll -> 'options') = 'array' then new.poll -> 'options' else '[]'::jsonb end)
               with ordinality as o(item, idx)
      ), '[]'::jsonb),
      'multi', coalesce((new.poll ->> 'multi')::boolean, false),
      'expires_at', now() + make_interval(hours => v_hours)
    );
  end if;

  if new.forwarded_from is not null then
    v_src_id := public.try_uuid(new.forwarded_from ->> 'message_id');
    if v_src_id is null or not public.can_read_message(v_src_id) then
      raise exception 'You cannot forward that message.' using errcode = '42501';
    end if;
    select * into v_src from public.messages where id = v_src_id;
    new.forwarded_from := jsonb_build_object(
      'message_id', v_src.id, 'author_id', v_src.author_id, 'created_at', v_src.created_at,
      'channel_id', v_src.channel_id, 'conversation_id', v_src.conversation_id
    );
  end if;

  new.mentions := public.extract_mentions(new.content);
  new.mention_everyone :=
    new.channel_id is not null
    and new.content ~ '(^|[^A-Za-z0-9_])@(everyone|here)([^A-Za-z0-9_]|$)'
    and public.has_channel_permission(new.channel_id, public.permission_bit('MENTION_EVERYONE'));
  new.mention_roles := case when new.channel_id is null then '{}' else public.extract_role_mentions(new.content, new.channel_id) end;
  return new;
end;
$$;

create or replace function public.validate_message_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.channel_id is distinct from old.channel_id
     or new.conversation_id is distinct from old.conversation_id
     or new.author_id is distinct from old.author_id
     or new.created_at <> old.created_at
     or new.reply_to_id is distinct from old.reply_to_id
     or new.poll is distinct from old.poll
     or new.forwarded_from is distinct from old.forwarded_from then
    raise exception 'immutable message fields cannot change' using errcode = '23514';
  end if;

  if new.content is distinct from old.content or new.attachments is distinct from old.attachments then
    if old.author_id is distinct from auth.uid() then
      raise exception 'only the author can edit a message' using errcode = '42501';
    end if;
    if old.channel_id is not null
       and public.is_timed_out((select c.server_id from public.channels c where c.id = old.channel_id)) then
      raise exception 'You are timed out in this server.' using errcode = '42501';
    end if;
    new.edited_at := now();
    new.mentions := public.extract_mentions(new.content);
    new.mention_everyone :=
      old.mention_everyone
      or (new.channel_id is not null
          and new.content ~ '(^|[^A-Za-z0-9_])@(everyone|here)([^A-Za-z0-9_]|$)'
          and public.has_channel_permission(new.channel_id, public.permission_bit('MENTION_EVERYONE')));
    new.mention_roles := case when new.channel_id is null then '{}' else public.extract_role_mentions(new.content, new.channel_id) end;
  else
    new.mentions := old.mentions;
    new.mention_everyone := old.mention_everyone;
    new.mention_roles := old.mention_roles;
  end if;

  if new.pinned is distinct from old.pinned then
    if old.channel_id is not null
       and not public.has_channel_permission(old.channel_id, public.permission_bit('MANAGE_MESSAGES')) then
      raise exception 'MANAGE_MESSAGES required to pin' using errcode = '42501';
    end if;
    new.pinned_at := case when new.pinned then now() end;
    new.pinned_by := case when new.pinned then auth.uid() end;
  else
    new.pinned_at := old.pinned_at;
    new.pinned_by := old.pinned_by;
  end if;
  return new;
end;
$$;

create or replace function public.prepare_reaction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_channel uuid;
begin
  new.user_id := auth.uid();
  select coalesce(m.channel_id, m.conversation_id), m.channel_id into new.scope_id, v_channel from public.messages m where m.id = new.message_id;
  if v_channel is not null and public.is_timed_out((select c.server_id from public.channels c where c.id = v_channel)) then
    raise exception 'You are timed out in this server.' using errcode = '42501';
  end if;
  if (select count(distinct r.emoji) from public.message_reactions r where r.message_id = new.message_id) >= 20
     and not exists (select 1 from public.message_reactions r where r.message_id = new.message_id and r.emoji = new.emoji) then
    raise exception 'A message can have at most 20 different reactions.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.can_join_voice_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_id     uuid := public.try_uuid(substring(p_topic from '^voice:(.+)$'));
  v_server uuid;
begin
  if v_id is null then
    return false;
  end if;
  select c.server_id into v_server from public.channels c where c.id = v_id and c.type in ('voice', 'stream');
  if v_server is not null then
    return public.has_channel_permission(v_id, public.permission_bit('CONNECT')) and not public.is_timed_out(v_server);
  end if;
  return public.can_use_conversation(v_id);
end;
$$;

-- Unread summary now also counts @role mentions for roles the caller holds.
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
           coalesce(rs.last_read_at, sm.joined_at) as last_read_at
      from public.channels c
      join public.server_members sm on sm.server_id = c.server_id and sm.user_id = (select id from me)
      left join public.channel_read_states rs on rs.channel_id = c.id and rs.user_id = (select id from me)
     where c.type = 'text'
       and public.has_channel_permission(c.id, public.permission_bit('VIEW_CHANNEL'))
  )
  select ch.id, 'channel', ch.server_id, ch.last_message_at, ch.last_read_at,
         case when ch.last_message_at is null or ch.last_message_at <= ch.last_read_at then 0 else (
           select least(count(*), 99)::integer from public.messages m
            where m.channel_id = ch.id and m.created_at > ch.last_read_at
              and m.author_id is distinct from (select id from me)
              and ((select id from me) = any (m.mentions) or m.mention_everyone or m.mention_roles && (select ids from my_roles))
         ) end
    from chans ch
  union all
  select cv.id, cv.type::text, null::uuid, cv.last_message_at, cm.last_read_at,
         case when cv.last_message_at <= cm.last_read_at then 0 else (
           select least(count(*), 99)::integer from public.messages m
            where m.conversation_id = cv.id and m.created_at > cm.last_read_at
              and m.author_id is distinct from (select id from me)
         ) end
    from public.conversations cv
    join public.conversation_members cm on cm.conversation_id = cv.id and cm.user_id = (select id from me)
$$;

-- -------------------------------------------------------------------------------------
-- 5. Audit log
-- -------------------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  server_id   uuid not null references public.servers (id) on delete cascade,
  actor_id    uuid references public.users (id) on delete set null,
  action      text not null,
  target_type text,
  target_id   uuid,
  target_name text,
  changes     jsonb not null default '{}'::jsonb,
  reason      text check (char_length(reason) <= 512),
  created_at  timestamptz not null default now()
);
create index audit_log_server_idx on public.audit_log (server_id, created_at desc);

create or replace function public.write_audit(
  p_server_id uuid, p_action text, p_target_type text, p_target_id uuid, p_target_name text,
  p_changes jsonb default '{}'::jsonb, p_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_server_id is null then return; end if;           -- system / service-role changes
  if not exists (select 1 from public.servers s where s.id = p_server_id) then return; end if; -- server being deleted
  insert into public.audit_log (server_id, actor_id, action, target_type, target_id, target_name, changes, reason)
  values (p_server_id, auth.uid(), p_action, p_target_type, p_target_id, p_target_name, coalesce(p_changes, '{}'::jsonb), left(p_reason, 512));
end;
$$;

-- One generic trigger for every audited table.
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_new  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old  jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row  jsonb := coalesce(v_new, v_old);
  v_diff jsonb;
  v_server uuid;
  v_name text;
  v_verb text := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;
begin
  if current_setting('aether.audit_skip', true) = '1' then return null; end if;

  case tg_table_name
    when 'servers' then
      v_diff := public.jsonb_diff(v_old, v_new);
      if v_diff <> '{}'::jsonb then
        perform public.write_audit((v_row ->> 'id')::uuid, 'server_update', 'server', (v_row ->> 'id')::uuid, v_row ->> 'name', v_diff);
      end if;

    when 'server_roles' then
      if tg_op = 'UPDATE' then
        v_diff := public.jsonb_diff(v_old, v_new);
        if v_diff = '{}'::jsonb or (select count(*) from jsonb_object_keys(v_diff)) = 1 and v_diff ? 'position' then return null; end if;
      end if;
      perform public.write_audit((v_row ->> 'server_id')::uuid, 'role_' || v_verb, 'role', (v_row ->> 'id')::uuid, v_row ->> 'name',
        case tg_op when 'UPDATE' then v_diff when 'INSERT' then v_new else v_old end);

    when 'member_roles' then
      select r.name into v_name from public.server_roles r where r.id = (v_row ->> 'role_id')::uuid;
      perform public.write_audit((v_row ->> 'server_id')::uuid, case tg_op when 'INSERT' then 'member_role_add' else 'member_role_remove' end,
        'member', (v_row ->> 'user_id')::uuid, null, jsonb_build_object('role_id', v_row ->> 'role_id', 'role_name', v_name));

    when 'channels' then
      if tg_op = 'UPDATE' then
        v_diff := public.jsonb_diff(v_old, v_new) - 'position' - 'parent_id';
        if v_diff = '{}'::jsonb then return null; end if; -- reorders are logged once by reorder_channels()
      end if;
      perform public.write_audit((v_row ->> 'server_id')::uuid, 'channel_' || v_verb, 'channel', (v_row ->> 'id')::uuid, v_row ->> 'name',
        case tg_op when 'UPDATE' then v_diff when 'INSERT' then jsonb_build_object('type', v_new ->> 'type') else '{}'::jsonb end);

    when 'channel_overwrites' then
      select c.server_id, c.name into v_server, v_name from public.channels c where c.id = (v_row ->> 'channel_id')::uuid;
      perform public.write_audit(v_server, 'overwrite_' || v_verb, 'channel', (v_row ->> 'channel_id')::uuid, v_name,
        jsonb_build_object('target_type', v_row ->> 'target_type', 'target_id', v_row ->> 'target_id',
                           'allow', v_row -> 'allow', 'deny', v_row -> 'deny'));

    when 'server_bans' then
      perform public.write_audit((v_row ->> 'server_id')::uuid, case tg_op when 'INSERT' then 'member_ban' else 'member_unban' end,
        'member', (v_row ->> 'user_id')::uuid, null, '{}'::jsonb, v_row ->> 'reason');

    when 'server_members' then
      if tg_op = 'DELETE' and (v_old ->> 'user_id')::uuid <> auth.uid() then
        perform public.write_audit((v_old ->> 'server_id')::uuid, 'member_kick', 'member', (v_old ->> 'user_id')::uuid, null);
      elsif tg_op = 'UPDATE' and (v_old -> 'nickname') is distinct from (v_new -> 'nickname') then
        perform public.write_audit((v_new ->> 'server_id')::uuid, 'member_nickname', 'member', (v_new ->> 'user_id')::uuid, null,
          jsonb_build_object('nickname', jsonb_build_object('old', v_old -> 'nickname', 'new', v_new -> 'nickname')));
      end if;

    when 'server_invites' then
      perform public.write_audit((v_row ->> 'server_id')::uuid, 'invite_' || v_verb, 'invite', null, v_row ->> 'code',
        jsonb_build_object('max_uses', v_row -> 'max_uses', 'expires_at', v_row -> 'expires_at'));
  end case;
  return null;
end;
$$;

create trigger audit_servers            after update                   on public.servers            for each row execute function public.audit_trigger();
create trigger audit_server_roles       after insert or update or delete on public.server_roles     for each row execute function public.audit_trigger();
create trigger audit_member_roles       after insert or delete          on public.member_roles       for each row execute function public.audit_trigger();
create trigger audit_channels           after insert or update or delete on public.channels         for each row execute function public.audit_trigger();
create trigger audit_channel_overwrites after insert or update or delete on public.channel_overwrites for each row execute function public.audit_trigger();
create trigger audit_server_bans        after insert or delete          on public.server_bans        for each row execute function public.audit_trigger();
create trigger audit_server_members     after update or delete          on public.server_members     for each row execute function public.audit_trigger();
create trigger audit_server_invites     after insert or delete          on public.server_invites     for each row execute function public.audit_trigger();

-- Custom (vanity) invite codes need MANAGE_SERVER; the default random code is always fine.
create or replace function public.validate_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.creator_id := auth.uid();
  new.uses := 0;
  if new.code !~ '^[0-9a-f]{10}$' and not public.has_server_permission(new.server_id, public.permission_bit('MANAGE_SERVER')) then
    raise exception 'Custom invite codes need the Manage Server permission.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger server_invites_validate before insert on public.server_invites for each row execute function public.validate_invite();

-- -------------------------------------------------------------------------------------
-- 6. RPCs
-- -------------------------------------------------------------------------------------
-- Reorder / re-parent channels in one call. p_items: [{ "id", "parent_id", "position" }]
create or replace function public.reorder_channels(p_server_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
begin
  if not public.has_server_permission(p_server_id, public.permission_bit('MANAGE_CHANNELS')) then
    raise exception 'MANAGE_CHANNELS required' using errcode = '42501';
  end if;
  perform set_config('aether.audit_skip', '1', true);
  for v_item in select * from jsonb_array_elements(p_items) loop
    update public.channels
       set position = (v_item ->> 'position')::integer,
           parent_id = case when type = 'category' then null else public.try_uuid(v_item ->> 'parent_id') end
     where id = public.try_uuid(v_item ->> 'id') and server_id = p_server_id;
  end loop;
  perform set_config('aether.audit_skip', '0', true);
  perform public.write_audit(p_server_id, 'channel_reorder', 'server', p_server_id, null, jsonb_build_object('count', jsonb_array_length(p_items)));
end;
$$;

-- Reorder roles. p_role_ids: non-default roles, highest first. Only roles below your own top
-- role may move, and they must stay below it (owners are unrestricted).
create or replace function public.reorder_roles(p_server_id uuid, p_role_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_top   integer := public.member_top_position(p_server_id, auth.uid());
  v_n     integer := cardinality(p_role_ids);
  v_i     integer;
  v_pos   integer;
  v_old   integer;
begin
  if not public.has_server_permission(p_server_id, public.permission_bit('MANAGE_ROLES')) then
    raise exception 'MANAGE_ROLES required' using errcode = '42501';
  end if;
  if v_n <> (select count(*) from public.server_roles where server_id = p_server_id and not is_default)
     or exists (select 1 from unnest(p_role_ids) r where not exists (select 1 from public.server_roles sr where sr.id = r and sr.server_id = p_server_id and not sr.is_default)) then
    raise exception 'Role list does not match this server.' using errcode = '23514';
  end if;
  perform set_config('aether.audit_skip', '1', true);
  for v_i in 1 .. v_n loop
    v_pos := v_n - v_i + 1;
    select position into v_old from public.server_roles where id = p_role_ids[v_i];
    if v_old <> v_pos then
      if v_old >= v_top or v_pos >= v_top then
        raise exception 'You can only move roles below your highest role.' using errcode = '42501';
      end if;
      update public.server_roles set position = v_pos where id = p_role_ids[v_i];
    end if;
  end loop;
  perform set_config('aether.audit_skip', '0', true);
  perform public.write_audit(p_server_id, 'role_reorder', 'server', p_server_id, null, '{}'::jsonb);
end;
$$;

-- Timeout (communication disabled) for 0 = clear, or 1 minute .. 28 days.
create or replace function public.timeout_member(p_server_id uuid, p_user_id uuid, p_minutes integer, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_server_permission(p_server_id, public.permission_bit('MODERATE_MEMBERS')) then
    raise exception 'Timeout Members permission required.' using errcode = '42501';
  end if;
  if public.member_top_position(p_server_id, p_user_id) >= public.member_top_position(p_server_id, auth.uid()) then
    raise exception 'You cannot time out a member at or above your highest role.' using errcode = '42501';
  end if;
  if p_minutes < 0 or p_minutes > 40320 then
    raise exception 'Timeouts last up to 28 days.' using errcode = '23514';
  end if;
  update public.server_members
     set timed_out_until = case when p_minutes = 0 then null else now() + make_interval(mins => p_minutes) end
   where server_id = p_server_id and user_id = p_user_id;
  if not found then raise exception 'Not a member of this server.' using errcode = 'P0002'; end if;
  perform public.write_audit(p_server_id, case when p_minutes = 0 then 'member_timeout_remove' else 'member_timeout' end,
    'member', p_user_id, null, jsonb_build_object('minutes', p_minutes), p_reason);
end;
$$;

-- Kick with an audit-log reason.
create or replace function public.kick_member(p_server_id uuid, p_user_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_server_permission(p_server_id, public.permission_bit('KICK_MEMBERS')) then
    raise exception 'Kick Members permission required.' using errcode = '42501';
  end if;
  if public.member_top_position(p_server_id, p_user_id) >= public.member_top_position(p_server_id, auth.uid()) then
    raise exception 'You cannot kick a member at or above your highest role.' using errcode = '42501';
  end if;
  perform set_config('aether.audit_skip', '1', true);
  delete from public.server_members where server_id = p_server_id and user_id = p_user_id;
  perform set_config('aether.audit_skip', '0', true);
  perform public.write_audit(p_server_id, 'member_kick', 'member', p_user_id, null, '{}'::jsonb, p_reason);
end;
$$;

-- Ban = record ban + remove membership (replaces schema.sql version so the removal isn't also logged as a kick).
create or replace function public.ban_member(p_server_id uuid, p_user_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_server_permission(p_server_id, public.permission_bit('BAN_MEMBERS')) then
    raise exception 'BAN_MEMBERS required' using errcode = '42501';
  end if;
  if public.member_top_position(p_server_id, p_user_id) >= public.member_top_position(p_server_id, auth.uid()) then
    raise exception 'cannot ban a member at or above your highest role' using errcode = '42501';
  end if;

  insert into public.server_bans (server_id, user_id, reason, banned_by)
  values (p_server_id, p_user_id, left(p_reason, 512), auth.uid())
  on conflict (server_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;

  perform set_config('aether.audit_skip', '1', true);
  delete from public.server_members where server_id = p_server_id and user_id = p_user_id;
  perform set_config('aether.audit_skip', '0', true);
end;
$$;

-- Moderators set someone else's nickname.
create or replace function public.set_member_nickname(p_server_id uuid, p_user_id uuid, p_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id = auth.uid() then
    if not public.has_server_permission(p_server_id, public.permission_bit('CHANGE_NICKNAME')) then
      raise exception 'Change Nickname permission required.' using errcode = '42501';
    end if;
  elsif not public.has_server_permission(p_server_id, public.permission_bit('MANAGE_NICKNAMES'))
     or public.member_top_position(p_server_id, p_user_id) >= public.member_top_position(p_server_id, auth.uid()) then
    raise exception 'You cannot change this member''s nickname.' using errcode = '42501';
  end if;
  update public.server_members set nickname = nullif(left(btrim(coalesce(p_nickname, '')), 32), '')
   where server_id = p_server_id and user_id = p_user_id;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 7. Privileges & RLS
-- -------------------------------------------------------------------------------------
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
alter table public.audit_log enable row level security;
create policy "audit log: VIEW_AUDIT_LOG"
  on public.audit_log for select to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('VIEW_AUDIT_LOG')));

revoke all on function public.is_timed_out(uuid, uuid), public.extract_role_mentions(text, uuid), public.jsonb_diff(jsonb, jsonb),
  public.write_audit(uuid, text, text, uuid, text, jsonb, text), public.audit_trigger(), public.validate_invite(),
  public.reorder_channels(uuid, jsonb), public.reorder_roles(uuid, uuid[]), public.timeout_member(uuid, uuid, integer, text),
  public.kick_member(uuid, uuid, text), public.set_member_nickname(uuid, uuid, text)
from public, anon;
grant execute on function public.is_timed_out(uuid, uuid), public.extract_role_mentions(text, uuid),
  public.reorder_channels(uuid, jsonb), public.reorder_roles(uuid, uuid[]), public.timeout_member(uuid, uuid, integer, text),
  public.kick_member(uuid, uuid, text), public.set_member_nickname(uuid, uuid, text)
to authenticated;

-- Live member list / role colors. (channels is deliberately NOT published: last_message_at changes on every message.)
alter publication supabase_realtime add table public.server_members, public.member_roles, public.server_roles;
