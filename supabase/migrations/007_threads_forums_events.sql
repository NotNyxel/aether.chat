-- aether.chat Batch 5: threads, forums & channel types (v0.8.0)
--   * threads: channels with thread_parent_id (public or private), members, archive, lock, auto-archive
--   * forum and media channels (channels.subtype): posts are threads, with tags, sort, layout, guidelines
--   * announcement channels: only moderators post; other servers can follow and receive published messages
--   * scheduled events with RSVPs
--   * permissions: CREATE_PUBLIC_THREADS (25), CREATE_PRIVATE_THREADS (26), SEND_MESSAGES_IN_THREADS (27),
--     MANAGE_THREADS (28), MANAGE_EVENTS (29)
-- Run after 006_voice_and_profiles.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Permissions
-- -------------------------------------------------------------------------------------------
create or replace function public.permission_bit(p_name text)
returns bigint language sql immutable parallel safe set search_path = '' as $$
  select case p_name
    when 'VIEW_CHANNEL'            then 1::bigint << 0
    when 'SEND_MESSAGES'           then 1::bigint << 1
    when 'ATTACH_FILES'            then 1::bigint << 2
    when 'MANAGE_MESSAGES'         then 1::bigint << 3
    when 'MENTION_EVERYONE'        then 1::bigint << 4
    when 'CONNECT'                 then 1::bigint << 5
    when 'SPEAK'                   then 1::bigint << 6
    when 'STREAM'                  then 1::bigint << 7
    when 'MUTE_MEMBERS'            then 1::bigint << 8
    when 'DEAFEN_MEMBERS'          then 1::bigint << 9
    when 'MOVE_MEMBERS'            then 1::bigint << 10
    when 'MANAGE_CHANNELS'         then 1::bigint << 11
    when 'MANAGE_ROLES'            then 1::bigint << 12
    when 'MANAGE_SERVER'           then 1::bigint << 13
    when 'CREATE_INVITE'           then 1::bigint << 14
    when 'KICK_MEMBERS'            then 1::bigint << 15
    when 'BAN_MEMBERS'             then 1::bigint << 16
    when 'CHANGE_NICKNAME'         then 1::bigint << 17
    when 'ADMINISTRATOR'           then 1::bigint << 18
    when 'MANAGE_NICKNAMES'        then 1::bigint << 19
    when 'MODERATE_MEMBERS'        then 1::bigint << 20
    when 'VIEW_AUDIT_LOG'          then 1::bigint << 21
    when 'USE_SOUNDBOARD'          then 1::bigint << 22
    when 'MANAGE_EXPRESSIONS'      then 1::bigint << 23
    when 'REQUEST_TO_SPEAK'        then 1::bigint << 24
    when 'CREATE_PUBLIC_THREADS'   then 1::bigint << 25
    when 'CREATE_PRIVATE_THREADS'  then 1::bigint << 26
    when 'SEND_MESSAGES_IN_THREADS' then 1::bigint << 27
    when 'MANAGE_THREADS'          then 1::bigint << 28
    when 'MANAGE_EVENTS'           then 1::bigint << 29
  end
$$;

create or replace function public.all_permissions()
returns bigint language sql immutable parallel safe set search_path = '' as $$ select (1::bigint << 30) - 1 $$;

create or replace function public.default_everyone_permissions()
returns bigint language sql immutable parallel safe set search_path = '' as $$
  select 147687::bigint | (1::bigint << 22) | (1::bigint << 24) | (1::bigint << 25) | (1::bigint << 26) | (1::bigint << 27)
$$;

update public.server_roles
   set permissions = permissions | (1::bigint << 25) | (1::bigint << 26) | (1::bigint << 27)
 where is_default;

-- -------------------------------------------------------------------------------------------
-- 2. Columns
-- -------------------------------------------------------------------------------------------
alter table public.channels
  add column if not exists subtype             text check (subtype in ('announcement', 'forum', 'media')),
  add column if not exists forum_tags          jsonb not null default '[]'::jsonb,
  add column if not exists require_tag         boolean not null default false,
  add column if not exists default_sort        text not null default 'activity' check (default_sort in ('activity', 'created')),
  add column if not exists default_layout      text not null default 'list' check (default_layout in ('list', 'gallery')),
  add column if not exists thread_parent_id    uuid references public.channels (id) on delete cascade,
  add column if not exists thread_owner_id     uuid references public.users (id) on delete set null,
  add column if not exists thread_private      boolean not null default false,
  add column if not exists thread_locked       boolean not null default false,
  add column if not exists thread_archived_at  timestamptz,
  add column if not exists thread_auto_archive integer not null default 1440 check (thread_auto_archive in (60, 1440, 4320, 10080)),
  add column if not exists thread_tags         text[] not null default '{}',
  add column if not exists thread_message_count integer not null default 0,
  add column if not exists thread_starter_id   uuid;

create or replace function public.is_valid_forum_tags(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 20
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e ->> 'id', '') !~ '^[a-z0-9]{1,16}$'
           or char_length(coalesce(e ->> 'name', '')) not between 1 and 20
           or char_length(coalesce(e ->> 'emoji', '')) > 16
     )
$$;

alter table public.channels drop constraint if exists channels_forum_tags_valid;
alter table public.channels add constraint channels_forum_tags_valid check (public.is_valid_forum_tags(forum_tags));
alter table public.channels drop constraint if exists channels_thread_shape;
alter table public.channels add constraint channels_thread_shape
  check (thread_parent_id is null or (type = 'text' and parent_id is null and subtype is null));

create index if not exists channels_thread_parent_idx on public.channels (thread_parent_id, last_message_at desc) where thread_parent_id is not null;

grant insert (subtype, forum_tags, require_tag, default_sort, default_layout) on public.channels to authenticated;
grant update (subtype, forum_tags, require_tag, default_sort, default_layout) on public.channels to authenticated;

alter table public.messages
  add column if not exists thread_id        uuid references public.channels (id) on delete set null,
  add column if not exists crossposted_from jsonb,
  add column if not exists published_at     timestamptz;

-- -------------------------------------------------------------------------------------------
-- 3. Thread members
-- -------------------------------------------------------------------------------------------
create table if not exists public.thread_members (
  thread_id uuid not null references public.channels (id) on delete cascade,
  user_id   uuid not null references public.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index if not exists thread_members_user_idx on public.thread_members (user_id);
alter table public.thread_members enable row level security;
revoke all on public.thread_members from anon, authenticated;
grant select on public.thread_members to authenticated;

-- -------------------------------------------------------------------------------------------
-- 4. Permission engine: the original per-channel computation becomes channel_permissions_core;
--    channel_permissions() adds the thread and announcement rules on top.
-- -------------------------------------------------------------------------------------------

-- (copied verbatim from schema.sql; the wrapper below adds thread and announcement rules)
create or replace function public.channel_permissions_core(p_channel_id uuid, p_user_id uuid default auth.uid())
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_server_id  uuid;
  v_perms      bigint;
  v_default_id uuid;
  v_allow      bigint;
  v_deny       bigint;
begin
  select c.server_id into v_server_id from public.channels c where c.id = p_channel_id;
  if v_server_id is null then
    return 0;
  end if;

  v_perms := public.server_permissions(v_server_id, p_user_id);
  if v_perms = 0 then
    return 0;
  end if;
  if (v_perms & public.permission_bit('ADMINISTRATOR')) <> 0 then
    return public.all_permissions();
  end if;

  -- @everyone overwrite
  select r.id into v_default_id from public.server_roles r where r.server_id = v_server_id and r.is_default;
  select o.allow, o.deny into v_allow, v_deny
    from public.channel_overwrites o
   where o.channel_id = p_channel_id and o.target_type = 'role' and o.target_id = v_default_id;
  if found then
    v_perms := (v_perms & ~v_deny) | v_allow;
  end if;

  -- Role overwrites, aggregated across every role the member holds
  select coalesce(bit_or(o.allow), 0), coalesce(bit_or(o.deny), 0)
    into v_allow, v_deny
    from public.channel_overwrites o
    join public.member_roles mr on mr.role_id = o.target_id and mr.user_id = p_user_id
   where o.channel_id = p_channel_id and o.target_type = 'role';
  v_perms := (v_perms & ~v_deny) | v_allow;

  -- Member-specific overwrite wins last
  select o.allow, o.deny into v_allow, v_deny
    from public.channel_overwrites o
   where o.channel_id = p_channel_id and o.target_type = 'member' and o.target_id = p_user_id;
  if found then
    v_perms := (v_perms & ~v_deny) | v_allow;
  end if;

  -- Without VIEW_CHANNEL nothing else in this channel is usable
  if (v_perms & public.permission_bit('VIEW_CHANNEL')) = 0 then
    return 0;
  end if;
  return v_perms;
end;
$$;

create or replace function public.channel_permissions(p_channel_id uuid, p_user_id uuid default auth.uid())
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ch     public.channels;
  v_perms  bigint;
  v_send   bigint := public.permission_bit('SEND_MESSAGES');
  v_manage boolean;
begin
  select * into v_ch from public.channels c where c.id = p_channel_id;
  if v_ch.id is null then
    return 0;
  end if;

  -- Threads (and forum posts) inherit the parent channel's permissions.
  if v_ch.thread_parent_id is not null then
    v_perms := public.channel_permissions_core(v_ch.thread_parent_id, p_user_id);
    if v_perms = 0 then
      return 0;
    end if;
    v_manage := (v_perms & public.permission_bit('MANAGE_THREADS')) <> 0;
    -- Private threads: members and thread managers only.
    if v_ch.thread_private and not v_manage
       and not exists (select 1 from public.thread_members tm where tm.thread_id = p_channel_id and tm.user_id = p_user_id) then
      return 0;
    end if;
    -- Sending in a thread uses SEND_MESSAGES_IN_THREADS instead of SEND_MESSAGES; locked threads are read-only.
    if (v_perms & public.permission_bit('SEND_MESSAGES_IN_THREADS')) <> 0 and (not v_ch.thread_locked or v_manage) then
      v_perms := v_perms | v_send;
    else
      v_perms := v_perms & ~v_send;
    end if;
    return v_perms;
  end if;

  v_perms := public.channel_permissions_core(p_channel_id, p_user_id);
  -- Announcement channels: only people who can manage messages post.
  if v_ch.subtype = 'announcement' and (v_perms & public.permission_bit('MANAGE_MESSAGES')) = 0 then
    v_perms := v_perms & ~v_send;
  end if;
  return v_perms;
end;
$$;

revoke all on function public.channel_permissions_core(uuid, uuid) from public, anon, authenticated;

drop policy if exists thread_members_read on public.thread_members;
create policy thread_members_read on public.thread_members for select to authenticated
  using (public.has_channel_permission(thread_id, public.permission_bit('VIEW_CHANNEL')));

-- -------------------------------------------------------------------------------------------
-- 5. Message rules
-- -------------------------------------------------------------------------------------------
-- (copied from 004 with a crosspost bypass and a forum guard)
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
  -- Crossposts from followed announcement channels are inserted by publish_message() on the
  -- author's behalf into servers they may not be in; that function already did the checks.
  if current_setting('aether.crosspost', true) = '1' then
    new.mentions := '{}';
    new.mention_roles := '{}';
    new.mention_everyone := false;
    return new;
  end if;
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
    if exists (select 1 from public.channels c where c.id = new.channel_id and c.subtype in ('forum', 'media')) then
      raise exception 'Post in a forum by creating a post.' using errcode = '23514';
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

-- Thread bookkeeping: message count, unarchive on new activity, auto-join posters, forum activity.
create or replace function public.after_thread_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ch public.channels;
begin
  if tg_op = 'INSERT' then
    select * into v_ch from public.channels where id = new.channel_id;
    if v_ch.thread_parent_id is null then return null; end if;
    perform set_config('aether.audit_skip', '1', true);
    update public.channels
       set thread_message_count = thread_message_count + 1,
           thread_archived_at = case when thread_locked then thread_archived_at end
     where id = new.channel_id;
    if new.author_id is not null then
      insert into public.thread_members (thread_id, user_id) values (new.channel_id, new.author_id) on conflict do nothing;
    end if;
    -- Forum/media: new posts and replies make the forum itself show as unread.
    update public.channels set last_message_at = new.created_at
     where id = v_ch.thread_parent_id and subtype in ('forum', 'media');
  elsif tg_op = 'DELETE' and old.channel_id is not null then
    update public.channels set thread_message_count = greatest(thread_message_count - 1, 0)
     where id = old.channel_id and thread_parent_id is not null;
  end if;
  return null;
end;
$$;
drop trigger if exists messages_thread_bookkeeping on public.messages;
create trigger messages_thread_bookkeeping after insert or delete on public.messages
  for each row execute function public.after_thread_message();

-- Subtypes: forum and media are fixed at creation; text and announcement can switch.
create or replace function public.validate_channel_subtype()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.subtype is not null and new.type <> 'text' then
    raise exception 'Only text channels can be announcement, forum or media channels.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.subtype is distinct from old.subtype
     and (coalesce(new.subtype, '') in ('forum', 'media') or coalesce(old.subtype, '') in ('forum', 'media')) then
    raise exception 'Forum and media channels can''t be converted.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists channels_validate_subtype on public.channels;
create trigger channels_validate_subtype before insert or update on public.channels
  for each row execute function public.validate_channel_subtype();

-- -------------------------------------------------------------------------------------------
-- 6. Thread RPCs
-- -------------------------------------------------------------------------------------------
create or replace function public.create_thread(
  p_parent_id uuid, p_name text, p_message_id uuid default null, p_private boolean default false,
  p_tags text[] default '{}', p_auto_archive integer default 1440
) returns public.channels
language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.channels;
  v_msg    public.messages;
  v_name   text := btrim(coalesce(p_name, ''));
  v_row    public.channels;
  v_forum  boolean;
  v_valid  text[];
begin
  if auth.uid() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  select * into v_parent from public.channels where id = p_parent_id;
  if v_parent.id is null or v_parent.type <> 'text' or v_parent.thread_parent_id is not null then
    raise exception 'Threads can only be started in text, announcement or forum channels.' using errcode = '22023';
  end if;
  if public.is_timed_out(v_parent.server_id) then
    raise exception 'You are timed out in this server.' using errcode = '42501';
  end if;
  v_forum := v_parent.subtype in ('forum', 'media');

  if v_forum then
    if p_message_id is not null or p_private then
      raise exception 'Forum posts are always public and stand alone.' using errcode = '22023';
    end if;
    if not public.has_channel_permission(p_parent_id, public.permission_bit('SEND_MESSAGES')) then
      raise exception 'You don''t have permission to post here.' using errcode = '42501';
    end if;
    select coalesce(array_agg(e ->> 'id'), '{}') into v_valid from jsonb_array_elements(v_parent.forum_tags) e;
    if not (coalesce(p_tags, '{}') <@ v_valid) or cardinality(coalesce(p_tags, '{}')) > 5 then
      raise exception 'Pick up to 5 of this forum''s tags.' using errcode = '22023';
    end if;
    if v_parent.require_tag and cardinality(coalesce(p_tags, '{}')) = 0 then
      raise exception 'This forum requires at least one tag.' using errcode = '22023';
    end if;
  else
    if not public.has_channel_permission(p_parent_id,
         public.permission_bit(case when p_private then 'CREATE_PRIVATE_THREADS' else 'CREATE_PUBLIC_THREADS' end)) then
      raise exception 'You don''t have permission to create % threads here.', case when p_private then 'private' else 'public' end
        using errcode = '42501';
    end if;
    if p_message_id is not null then
      if p_private then raise exception 'Private threads can''t start from a message.' using errcode = '22023'; end if;
      select * into v_msg from public.messages where id = p_message_id and channel_id = p_parent_id;
      if v_msg.id is null then raise exception 'That message isn''t in this channel.' using errcode = '22023'; end if;
      if v_msg.thread_id is not null then raise exception 'That message already has a thread.' using errcode = '23505'; end if;
      if v_name = '' then v_name := left(regexp_replace(coalesce(v_msg.content, ''), '\s+', ' ', 'g'), 80); end if;
    end if;
  end if;
  if v_name = '' then v_name := 'New thread'; end if;
  if char_length(v_name) > 100 then v_name := left(v_name, 100); end if;
  if p_auto_archive not in (60, 1440, 4320, 10080) then p_auto_archive := 1440; end if;

  perform set_config('aether.audit_skip', '1', true);
  insert into public.channels (server_id, type, name, position, thread_parent_id, thread_owner_id, thread_private,
                               thread_auto_archive, thread_tags, thread_starter_id, last_message_at)
  values (v_parent.server_id, 'text', v_name, 0, p_parent_id, auth.uid(), coalesce(p_private, false),
          p_auto_archive, coalesce(p_tags, '{}'), p_message_id, now())
  returning * into v_row;
  insert into public.thread_members (thread_id, user_id) values (v_row.id, auth.uid());
  if p_message_id is not null then
    update public.messages set thread_id = v_row.id where id = p_message_id;
  end if;
  return v_row;
end;
$$;

-- Rename, archive, lock, retag, auto-archive. Owner may rename/archive/retag; MANAGE_THREADS may do anything.
create or replace function public.update_thread(
  p_thread_id uuid, p_name text default null, p_archived boolean default null, p_locked boolean default null,
  p_tags text[] default null, p_auto_archive integer default null
) returns public.channels
language plpgsql security definer set search_path = '' as $$
declare
  v_row    public.channels;
  v_parent public.channels;
  v_manage boolean;
  v_valid  text[];
begin
  select * into v_row from public.channels where id = p_thread_id and thread_parent_id is not null;
  if v_row.id is null then raise exception 'Thread not found.' using errcode = '22023'; end if;
  select * into v_parent from public.channels where id = v_row.thread_parent_id;
  v_manage := public.has_channel_permission(v_parent.id, public.permission_bit('MANAGE_THREADS'));
  if not v_manage and v_row.thread_owner_id is distinct from auth.uid() then
    raise exception 'Only the thread''s creator or someone with Manage Threads can change it.' using errcode = '42501';
  end if;
  if p_locked is not null and not v_manage then
    raise exception 'Locking threads needs Manage Threads.' using errcode = '42501';
  end if;
  if v_row.thread_locked and not v_manage then
    raise exception 'This thread is locked.' using errcode = '42501';
  end if;
  if p_tags is not null then
    select coalesce(array_agg(e ->> 'id'), '{}') into v_valid from jsonb_array_elements(v_parent.forum_tags) e;
    if not (p_tags <@ v_valid) or cardinality(p_tags) > 5 then
      raise exception 'Pick up to 5 of this forum''s tags.' using errcode = '22023';
    end if;
  end if;
  perform set_config('aether.audit_skip', '1', true);
  update public.channels
     set name = coalesce(nullif(left(btrim(p_name), 100), ''), name),
         thread_archived_at = case when p_archived is null then thread_archived_at when p_archived then now() end,
         thread_locked = coalesce(p_locked, thread_locked),
         thread_tags = coalesce(p_tags, thread_tags),
         thread_auto_archive = case when p_auto_archive in (60, 1440, 4320, 10080) then p_auto_archive else thread_auto_archive end,
         -- reopening counts as activity so auto-archive doesn't immediately close it again
         last_message_at = case when p_archived = false then now() else last_message_at end
   where id = p_thread_id
  returning * into v_row;
  if p_locked is not null then
    perform public.write_audit(v_row.server_id, case when p_locked then 'thread_lock' else 'thread_unlock' end, 'channel', v_row.id, v_row.name);
  end if;
  return v_row;
end;
$$;

create or replace function public.delete_thread(p_thread_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.channels;
begin
  select * into v_row from public.channels where id = p_thread_id and thread_parent_id is not null;
  if v_row.id is null then return; end if;
  if v_row.thread_owner_id is distinct from auth.uid()
     and not public.has_channel_permission(v_row.thread_parent_id, public.permission_bit('MANAGE_THREADS')) then
    raise exception 'Only the thread''s creator or someone with Manage Threads can delete it.' using errcode = '42501';
  end if;
  update public.messages set thread_id = null where thread_id = p_thread_id;
  perform set_config('aether.audit_skip', '1', true);
  delete from public.channels where id = p_thread_id;
  perform public.write_audit(v_row.server_id, 'thread_delete', 'channel', v_row.id, v_row.name);
end;
$$;

-- Join (follow) or leave a thread. Private threads can only be joined by being added.
create or replace function public.join_thread(p_thread_id uuid, p_join boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_join then
    if not public.has_channel_permission(p_thread_id, public.permission_bit('VIEW_CHANNEL'))
       or not exists (select 1 from public.channels where id = p_thread_id and thread_parent_id is not null) then
      raise exception 'Thread not found.' using errcode = '22023';
    end if;
    insert into public.thread_members (thread_id, user_id) values (p_thread_id, auth.uid()) on conflict do nothing;
  else
    delete from public.thread_members where thread_id = p_thread_id and user_id = auth.uid();
  end if;
end;
$$;

-- Add someone to a thread (private threads: any member can add people who can see the parent channel).
create or replace function public.add_thread_member(p_thread_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.channels;
begin
  select * into v_row from public.channels where id = p_thread_id and thread_parent_id is not null;
  if v_row.id is null or not public.has_channel_permission(p_thread_id, public.permission_bit('SEND_MESSAGES')) then
    raise exception 'You can''t add people to this thread.' using errcode = '42501';
  end if;
  if public.channel_permissions_core(v_row.thread_parent_id, p_user_id) & public.permission_bit('VIEW_CHANNEL') = 0 then
    raise exception 'They can''t see this channel.' using errcode = '42501';
  end if;
  insert into public.thread_members (thread_id, user_id) values (p_thread_id, p_user_id) on conflict do nothing;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 7. Unread summary: threads count only once you've joined them
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
    join public.conversation_members cm on cm.conversation_id = cv.id and cm.user_id = (select id from me)
    left join public.notification_settings ns on ns.user_id = (select id from me) and ns.scope_id = cv.id
$$;

-- -------------------------------------------------------------------------------------------
-- 8. Announcement follows and publishing
-- -------------------------------------------------------------------------------------------
create table if not exists public.channel_follows (
  source_channel_id uuid not null references public.channels (id) on delete cascade,
  target_channel_id uuid not null references public.channels (id) on delete cascade,
  created_by        uuid default auth.uid() references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  primary key (source_channel_id, target_channel_id),
  check (source_channel_id <> target_channel_id)
);
create index if not exists channel_follows_target_idx on public.channel_follows (target_channel_id);
alter table public.channel_follows enable row level security;
drop policy if exists channel_follows_read on public.channel_follows;
create policy channel_follows_read on public.channel_follows for select to authenticated
  using (public.has_channel_permission(target_channel_id, public.permission_bit('MANAGE_CHANNELS'))
         or public.has_channel_permission(source_channel_id, public.permission_bit('MANAGE_CHANNELS')));
revoke all on public.channel_follows from anon, authenticated;
grant select on public.channel_follows to authenticated;

create or replace function public.follow_channel(p_source_id uuid, p_target_id uuid, p_follow boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_src public.channels;
  v_tgt public.channels;
begin
  select * into v_src from public.channels where id = p_source_id;
  select * into v_tgt from public.channels where id = p_target_id;
  if not public.has_channel_permission(p_target_id, public.permission_bit('MANAGE_CHANNELS')) then
    raise exception 'You need Manage Channels in the channel that receives the posts.' using errcode = '42501';
  end if;
  if not p_follow then
    delete from public.channel_follows where source_channel_id = p_source_id and target_channel_id = p_target_id;
    return;
  end if;
  if v_src.subtype is distinct from 'announcement' or not public.has_channel_permission(p_source_id, public.permission_bit('VIEW_CHANNEL')) then
    raise exception 'You can only follow announcement channels you can see.' using errcode = '22023';
  end if;
  if v_tgt.type <> 'text' or v_tgt.thread_parent_id is not null or v_tgt.subtype in ('forum', 'media') then
    raise exception 'Pick a text channel to receive the posts.' using errcode = '22023';
  end if;
  insert into public.channel_follows (source_channel_id, target_channel_id) values (p_source_id, p_target_id) on conflict do nothing;
  perform public.write_audit(v_tgt.server_id, 'channel_follow', 'channel', v_tgt.id, v_tgt.name,
    jsonb_build_object('source_channel', v_src.name, 'source_server', (select s.name from public.servers s where s.id = v_src.server_id)));
end;
$$;

-- Publishes an announcement to every following channel. Returns how many channels received it.
create or replace function public.publish_message(p_message_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_msg    public.messages;
  v_ch     public.channels;
  v_server text;
  v_count  integer := 0;
  v_target uuid;
begin
  select * into v_msg from public.messages where id = p_message_id;
  select * into v_ch from public.channels where id = v_msg.channel_id;
  if v_msg.id is null or v_ch.subtype is distinct from 'announcement' then
    raise exception 'Only messages in announcement channels can be published.' using errcode = '22023';
  end if;
  if v_msg.author_id is distinct from auth.uid()
     and not public.has_channel_permission(v_ch.id, public.permission_bit('MANAGE_MESSAGES')) then
    raise exception 'Only the author or a moderator can publish this.' using errcode = '42501';
  end if;
  if v_msg.published_at is not null then
    raise exception 'Already published.' using errcode = '23505';
  end if;
  update public.messages set published_at = now() where id = p_message_id;
  select s.name into v_server from public.servers s where s.id = v_ch.server_id;

  perform set_config('aether.crosspost', '1', true);
  for v_target in select f.target_channel_id from public.channel_follows f where f.source_channel_id = v_ch.id loop
    insert into public.messages (channel_id, author_id, content, attachments, crossposted_from)
    values (v_target, v_msg.author_id, v_msg.content, v_msg.attachments,
            jsonb_build_object('message_id', v_msg.id, 'channel_id', v_ch.id, 'channel_name', v_ch.name,
                               'server_id', v_ch.server_id, 'server_name', v_server));
    v_count := v_count + 1;
  end loop;
  perform set_config('aether.crosspost', '0', true);
  return v_count;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 9. Scheduled events
-- -------------------------------------------------------------------------------------------
create table if not exists public.server_events (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers (id) on delete cascade,
  channel_id  uuid references public.channels (id) on delete set null,
  location    text check (char_length(location) between 1 and 100),
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (char_length(description) <= 1000),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  status      text not null default 'scheduled' check (status in ('scheduled', 'active', 'completed', 'canceled')),
  created_by  uuid default auth.uid() references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (channel_id is not null or location is not null)
);
create index if not exists server_events_server_idx on public.server_events (server_id, starts_at);

create table if not exists public.event_rsvps (
  event_id   uuid not null references public.server_events (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create or replace function public.validate_server_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.channel_id is not null and not exists (
    select 1 from public.channels c where c.id = new.channel_id and c.server_id = new.server_id and c.type in ('voice', 'stream')
  ) then
    raise exception 'Events happen in a voice or stage channel of this server (or somewhere else, with a location).' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.status := 'scheduled';
    if new.starts_at < now() - interval '5 minutes' then
      raise exception 'Pick a start time in the future.' using errcode = '23514';
    end if;
  else
    if new.server_id <> old.server_id then raise exception 'Events can''t move between servers.' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists server_events_validate on public.server_events;
create trigger server_events_validate before insert or update on public.server_events
  for each row execute function public.validate_server_event();

create or replace function public.server_events_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row public.server_events := coalesce(new, old);
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.write_audit(v_row.server_id, 'event_' || new.status, 'event', v_row.id, v_row.name);
  else
    perform public.write_audit(v_row.server_id,
      'event_' || case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end, 'event', v_row.id, v_row.name);
  end if;
  return null;
end;
$$;
drop trigger if exists server_events_audit on public.server_events;
create trigger server_events_audit after insert or update or delete on public.server_events
  for each row execute function public.server_events_audit();

alter table public.server_events enable row level security;
drop policy if exists server_events_read on public.server_events;
create policy server_events_read on public.server_events for select to authenticated
  using (public.is_server_member(server_id));
drop policy if exists server_events_write on public.server_events;
create policy server_events_write on public.server_events for insert to authenticated
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_EVENTS')));
drop policy if exists server_events_update on public.server_events;
create policy server_events_update on public.server_events for update to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_EVENTS')))
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_EVENTS')));
drop policy if exists server_events_delete on public.server_events;
create policy server_events_delete on public.server_events for delete to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_EVENTS')));
revoke all on public.server_events from anon, authenticated;
grant select, delete on public.server_events to authenticated;
grant insert (server_id, channel_id, location, name, description, starts_at, ends_at) on public.server_events to authenticated;
grant update (channel_id, location, name, description, starts_at, ends_at, status) on public.server_events to authenticated;

alter table public.event_rsvps enable row level security;
drop policy if exists event_rsvps_read on public.event_rsvps;
create policy event_rsvps_read on public.event_rsvps for select to authenticated
  using (exists (select 1 from public.server_events e where e.id = event_id and public.is_server_member(e.server_id)));
drop policy if exists event_rsvps_own on public.event_rsvps;
create policy event_rsvps_own on public.event_rsvps for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.server_events e where e.id = event_id and public.is_server_member(e.server_id)
                          and e.status in ('scheduled', 'active')));
drop policy if exists event_rsvps_delete on public.event_rsvps;
create policy event_rsvps_delete on public.event_rsvps for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.event_rsvps from anon, authenticated;
grant select, delete on public.event_rsvps to authenticated;
grant insert (event_id) on public.event_rsvps to authenticated;

-- -------------------------------------------------------------------------------------------
-- 10. Function privileges
-- -------------------------------------------------------------------------------------------
revoke all on function public.create_thread(uuid, text, uuid, boolean, text[], integer),
                       public.update_thread(uuid, text, boolean, boolean, text[], integer),
                       public.delete_thread(uuid), public.join_thread(uuid, boolean), public.add_thread_member(uuid, uuid),
                       public.follow_channel(uuid, uuid, boolean), public.publish_message(uuid)
  from public, anon;
grant execute on function public.create_thread(uuid, text, uuid, boolean, text[], integer),
                          public.update_thread(uuid, text, boolean, boolean, text[], integer),
                          public.delete_thread(uuid), public.join_thread(uuid, boolean), public.add_thread_member(uuid, uuid),
                          public.follow_channel(uuid, uuid, boolean), public.publish_message(uuid)
  to authenticated;

-- -------------------------------------------------------------------------------------------
-- 11. Fix: creating a channel with INSERT ... RETURNING (what the app does) failed RLS, because
--     the SELECT policy's permission lookup can't see the row inside the same statement. Channel
--     managers may also see non-thread channels through their server-level permission.
-- -------------------------------------------------------------------------------------------
drop policy if exists "channels: VIEW_CHANNEL required" on public.channels;
create policy "channels: VIEW_CHANNEL required"
  on public.channels for select to authenticated
  using (
    public.has_channel_permission(id, public.permission_bit('VIEW_CHANNEL'))
    or (thread_parent_id is null and public.has_server_permission(server_id, public.permission_bit('MANAGE_CHANNELS')))
  );
