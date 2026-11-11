-- =====================================================================================
-- AetherChat — Supabase schema, Row-Level Security, Realtime & Storage policies
-- -------------------------------------------------------------------------------------
-- Apply with:  supabase db push   (or paste into the SQL editor of a fresh project)
--
-- Design notes
--   * Permissions are a 64-bit mask (bigint) evaluated with the Discord-style algorithm:
--       server base = OR(@everyone, member roles) → ADMINISTRATOR short-circuits →
--       channel overwrites applied in order @everyone → roles → member (deny, then allow).
--   * Every permission helper is SECURITY DEFINER with an empty search_path, so it can read
--     membership tables without recursing through their own RLS policies.
--   * Clients never write author/owner columns directly: column-level GRANTs plus defaults
--     of auth.uid() make spoofing impossible even if a policy were misconfigured.
--   * Voice signaling uses Realtime *private* channels named  voice:<channel_uuid>,
--     guarded by policies on realtime.messages that require the CONNECT bit.
-- =====================================================================================

create extension if not exists citext with schema extensions;

-- -------------------------------------------------------------------------------------
-- 0. Types
-- -------------------------------------------------------------------------------------
create type public.channel_type as enum ('category', 'text', 'voice', 'stream');
create type public.overwrite_target as enum ('role', 'member');

-- -------------------------------------------------------------------------------------
-- 1. Permission bit catalogue (mirrored in src/lib/permissions.ts)
-- -------------------------------------------------------------------------------------
create or replace function public.permission_bit(p_name text)
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$
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
  end
$$;

-- Every defined bit set (bits 0..18).
create or replace function public.all_permissions()
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$ select (1::bigint << 19) - 1 $$;

-- Permissions granted to @everyone in a freshly created server:
-- VIEW_CHANNEL | SEND_MESSAGES | ATTACH_FILES | CONNECT | SPEAK | STREAM | CREATE_INVITE | CHANGE_NICKNAME
create or replace function public.default_everyone_permissions()
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$ select 147687::bigint $$;

-- Safe text → uuid cast (returns NULL instead of raising), used for Realtime topics and storage paths.
create or replace function public.try_uuid(p_text text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_text::uuid
  end
$$;

-- Validates the attachments JSONB array on messages:
--   [{ "url": "https://…", "name": "a.png", "size": 1234, "content_type": "image/png",
--      "width"?: 800, "height"?: 600 }]
create or replace function public.is_valid_attachments(p_attachments jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select jsonb_typeof(p_attachments) = 'array'
     and jsonb_array_length(p_attachments) <= 10
     and not exists (
       select 1
       from jsonb_array_elements(p_attachments) as a(item)
       where jsonb_typeof(a.item) <> 'object'
          or coalesce(a.item ->> 'url', '') !~ '^https://'
          or char_length(coalesce(a.item ->> 'name', '')) not between 1 and 255
          or jsonb_typeof(a.item -> 'size') is distinct from 'number'
          or (a.item ->> 'size')::numeric not between 0 and 26214400
          or coalesce(a.item ->> 'content_type', '') !~ '^[a-z]+/[a-zA-Z0-9.+-]+$'
          or (a.item ? 'width'  and jsonb_typeof(a.item -> 'width')  is distinct from 'number')
          or (a.item ? 'height' and jsonb_typeof(a.item -> 'height') is distinct from 'number')
     )
$$;

-- Validates profile badge arrays: up to 32 short string identifiers.
create or replace function public.is_valid_badge_ids(p_badges jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select jsonb_typeof(p_badges) = 'array'
     and jsonb_array_length(p_badges) <= 32
     and not exists (
       select 1 from jsonb_array_elements(p_badges) as b(item)
       where jsonb_typeof(b.item) <> 'string'
          or (b.item #>> '{}') !~ '^[a-z0-9_-]{1,48}$'
     )
$$;

-- -------------------------------------------------------------------------------------
-- 2. Tables
-- -------------------------------------------------------------------------------------

-- 2.1 Profiles ------------------------------------------------------------------------
create table public.users (
  id               uuid primary key references auth.users (id) on delete cascade,
  username         extensions.citext not null unique
                     check (username ~ '^[A-Za-z0-9_.]{2,32}$'),
  display_name     text check (char_length(display_name) between 1 and 64),
  custom_status    text check (char_length(custom_status) <= 128),
  status_emoji     text check (char_length(status_emoji) <= 64),
  bio              text check (char_length(bio) <= 4000),                -- Markdown source
  avatar_url       text check (avatar_url ~ '^https://'),
  avatar_frame     text check (avatar_frame ~ '^[a-z0-9_-]{1,48}$'),     -- animated frame preset id
  banner_url       text check (banner_url ~ '^https://'),
  primary_color    text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color     text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  badge_ids        jsonb not null default '[]'::jsonb
                     check (public.is_valid_badge_ids(badge_ids)),
  custom_css       text check (octet_length(custom_css) <= 32768),
  audio_status_url text check (audio_status_url ~ '^https://'),
  theme_preset     text not null default 'oled-dark'
                     check (theme_preset in ('oled-dark', 'cyberpunk', 'nord', 'aether-glass', 'custom')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on column public.users.badge_ids is
  'JSONB array of badge identifiers. Not client-writable; awarded by service role only.';

-- 2.2 Servers ----------------------------------------------------------------------------
create table public.servers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 100),
  description text check (char_length(description) <= 1000),
  icon_url    text check (icon_url ~ '^https://'),
  banner_url  text check (banner_url ~ '^https://'),
  owner_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index servers_owner_idx on public.servers (owner_id);

create table public.server_members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id   uuid not null references public.users (id) on delete cascade,
  nickname  text check (char_length(nickname) between 1 and 32),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index server_members_user_idx on public.server_members (user_id);

create table public.server_bans (
  server_id  uuid not null references public.servers (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  reason     text check (char_length(reason) <= 512),
  banned_by  uuid default auth.uid() references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

-- 2.3 Roles --------------------------------------------------------------------------------
create table public.server_roles (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 64),
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  position    integer not null default 1 check (position >= 0),
  permissions bigint not null default 0
                check (permissions >= 0 and permissions <= public.all_permissions()),
  is_default  boolean not null default false,  -- the implicit @everyone role
  hoist       boolean not null default false,  -- show separately in the member list
  mentionable boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (id, server_id),
  check (not is_default or position = 0)
);
create unique index server_roles_one_default_idx on public.server_roles (server_id) where is_default;
create index server_roles_server_idx on public.server_roles (server_id, position desc);

create table public.member_roles (
  server_id uuid not null,
  user_id   uuid not null,
  role_id   uuid not null,
  primary key (user_id, role_id),
  foreign key (server_id, user_id) references public.server_members (server_id, user_id) on delete cascade,
  foreign key (role_id, server_id) references public.server_roles (id, server_id) on delete cascade
);
create index member_roles_role_idx on public.member_roles (role_id);
create index member_roles_server_user_idx on public.member_roles (server_id, user_id);

-- 2.4 Channels -------------------------------------------------------------------------------
create table public.channels (
  id                 uuid primary key default gen_random_uuid(),
  server_id          uuid not null references public.servers (id) on delete cascade,
  parent_id          uuid references public.channels (id) on delete set null,  -- category
  type               public.channel_type not null default 'text',
  name               text not null check (char_length(btrim(name)) between 1 and 100),
  topic              text check (char_length(topic) <= 1024),
  position           integer not null default 0,
  rate_limit_seconds integer not null default 0 check (rate_limit_seconds between 0 and 21600),
  user_limit         integer check (user_limit between 1 and 25),   -- voice/stream only (mesh ceiling)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, server_id),
  check (user_limit is null or type in ('voice', 'stream')),
  check (type <> 'category' or parent_id is null)
);
create index channels_server_idx on public.channels (server_id, position);
create index channels_parent_idx on public.channels (parent_id);

create table public.channel_overwrites (
  channel_id  uuid not null references public.channels (id) on delete cascade,
  target_type public.overwrite_target not null,
  target_id   uuid not null,  -- server_roles.id or users.id depending on target_type
  allow       bigint not null default 0 check (allow >= 0 and allow <= public.all_permissions()),
  deny        bigint not null default 0 check (deny  >= 0 and deny  <= public.all_permissions()),
  primary key (channel_id, target_type, target_id),
  check ((allow & deny) = 0)
);

-- 2.5 Messages ---------------------------------------------------------------------------------
create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.channels (id) on delete cascade,
  author_id   uuid default auth.uid() references public.users (id) on delete set null,
  content     text not null default '' check (char_length(content) <= 4000),   -- Markdown source
  attachments jsonb not null default '[]'::jsonb check (public.is_valid_attachments(attachments)),
  reply_to_id uuid references public.messages (id) on delete set null,
  pinned      boolean not null default false,
  edited_at   timestamptz,
  created_at  timestamptz not null default now(),
  check (char_length(btrim(content)) > 0 or jsonb_array_length(attachments) > 0)
);
create index messages_channel_created_idx on public.messages (channel_id, created_at desc, id desc);
create index messages_author_idx on public.messages (author_id);
create index messages_pinned_idx on public.messages (channel_id) where pinned;

-- 2.6 Invites ----------------------------------------------------------------------------------
create table public.server_invites (
  code       text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
               check (code ~ '^[A-Za-z0-9]{6,32}$'),
  server_id  uuid not null references public.servers (id) on delete cascade,
  creator_id uuid default auth.uid() references public.users (id) on delete set null,
  max_uses   integer check (max_uses between 1 and 1000),
  uses       integer not null default 0 check (uses >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index server_invites_server_idx on public.server_invites (server_id);

-- -------------------------------------------------------------------------------------
-- 3. Permission engine (SECURITY DEFINER; bypasses RLS on lookup tables, no recursion)
-- -------------------------------------------------------------------------------------
create or replace function public.is_server_member(p_server_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.server_members m
    where m.server_id = p_server_id and m.user_id = auth.uid()
  )
$$;

-- Effective server-level permissions for a user (owner and ADMINISTRATOR → everything).
create or replace function public.server_permissions(p_server_id uuid, p_user_id uuid default auth.uid())
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_perms bigint;
begin
  if p_user_id is null then
    return 0;
  end if;

  select s.owner_id into v_owner from public.servers s where s.id = p_server_id;
  if v_owner is null then
    return 0;
  end if;
  if v_owner = p_user_id then
    return public.all_permissions();
  end if;

  if not exists (
    select 1 from public.server_members m where m.server_id = p_server_id and m.user_id = p_user_id
  ) then
    return 0;
  end if;

  select coalesce(bit_or(r.permissions), 0)
    into v_perms
    from public.server_roles r
   where r.server_id = p_server_id
     and (
       r.is_default
       or exists (select 1 from public.member_roles mr where mr.role_id = r.id and mr.user_id = p_user_id)
     );

  if (v_perms & public.permission_bit('ADMINISTRATOR')) <> 0 then
    return public.all_permissions();
  end if;
  return v_perms;
end;
$$;

-- Effective channel-level permissions: base → @everyone overwrite → role overwrites → member overwrite.
create or replace function public.channel_permissions(p_channel_id uuid, p_user_id uuid default auth.uid())
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

create or replace function public.has_server_permission(p_server_id uuid, p_permission bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission <> 0 and (public.server_permissions(p_server_id, auth.uid()) & p_permission) = p_permission
$$;

create or replace function public.has_channel_permission(p_channel_id uuid, p_permission bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission <> 0 and (public.channel_permissions(p_channel_id, auth.uid()) & p_permission) = p_permission
$$;

-- Highest role position held by a user (owner = max int). Used to enforce role hierarchy.
create or replace function public.member_top_position(p_server_id uuid, p_user_id uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.servers s where s.id = p_server_id and s.owner_id = p_user_id)
      then 2147483647
    else coalesce((
      select max(r.position)
        from public.member_roles mr
        join public.server_roles r on r.id = mr.role_id
       where mr.server_id = p_server_id and mr.user_id = p_user_id
    ), 0)
  end
$$;

-- Realtime topic guard: "voice:<uuid>" is joinable only with CONNECT on a voice/stream channel.
create or replace function public.can_join_voice_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channels c
     where c.id = public.try_uuid(substring(p_topic from '^voice:(.+)$'))
       and c.type in ('voice', 'stream')
  )
  and public.has_channel_permission(
        public.try_uuid(substring(p_topic from '^voice:(.+)$')),
        public.permission_bit('CONNECT')
      )
$$;

-- -------------------------------------------------------------------------------------
-- 4. Triggers
-- -------------------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_updated_at    before update on public.users    for each row execute function public.set_updated_at();
create trigger servers_updated_at  before update on public.servers  for each row execute function public.set_updated_at();
create trigger channels_updated_at before update on public.channels for each row execute function public.set_updated_at();

-- 4.1 Auto-create a profile row for every new auth user ----------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested text;
  v_fallback  text := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  v_username  text;
begin
  v_requested := regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^A-Za-z0-9_.]', '', 'g');
  v_requested := left(v_requested, 32);

  if char_length(v_requested) >= 2
     and not exists (select 1 from public.users u where u.username = v_requested::extensions.citext) then
    v_username := v_requested;
  else
    v_username := v_fallback;
  end if;

  insert into public.users (id, username, display_name)
  values (
    new.id,
    v_username,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 64), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 4.2 Bootstrap a new server: owner membership, @everyone role, starter channels ------------
create or replace function public.handle_new_server()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text_cat  uuid;
  v_voice_cat uuid;
begin
  insert into public.server_members (server_id, user_id) values (new.id, new.owner_id);

  insert into public.server_roles (server_id, name, position, permissions, is_default)
  values (new.id, '@everyone', 0, public.default_everyone_permissions(), true);

  insert into public.channels (server_id, type, name, position)
  values (new.id, 'category', 'Text Channels', 0) returning id into v_text_cat;
  insert into public.channels (server_id, type, name, position)
  values (new.id, 'category', 'Voice Channels', 1) returning id into v_voice_cat;

  insert into public.channels (server_id, parent_id, type, name, position) values
    (new.id, v_text_cat,  'text',   'general', 0),
    (new.id, v_voice_cat, 'voice',  'Lounge',  0),
    (new.id, v_voice_cat, 'stream', 'Stage',   1);
  return new;
end;
$$;

create trigger on_server_created
  after insert on public.servers
  for each row execute function public.handle_new_server();

-- 4.3 Channel hierarchy integrity ------------------------------------------------------------
create or replace function public.validate_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.channels%rowtype;
begin
  if new.parent_id is not null then
    select * into v_parent from public.channels where id = new.parent_id;
    if not found or v_parent.type <> 'category' then
      raise exception 'parent_id must reference a category channel' using errcode = '23514';
    end if;
    if v_parent.server_id <> new.server_id then
      raise exception 'parent category belongs to a different server' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.server_id <> old.server_id then
    raise exception 'channels cannot move between servers' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.type <> old.type then
    raise exception 'channel type is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger channels_validate
  before insert or update on public.channels
  for each row execute function public.validate_channel();

-- 4.4 Message integrity: author pinning, reply scope, slow-mode, edit rules -----------------
create or replace function public.validate_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type      public.channel_type;
  v_rate      integer;
  v_last_sent timestamptz;
begin
  new.author_id  := auth.uid();
  new.created_at := now();
  new.edited_at  := null;
  new.pinned     := false;

  select c.type, c.rate_limit_seconds into v_type, v_rate from public.channels c where c.id = new.channel_id;
  if v_type is distinct from 'text' then
    raise exception 'messages can only be sent to text channels' using errcode = '23514';
  end if;

  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m where m.id = new.reply_to_id and m.channel_id = new.channel_id
  ) then
    raise exception 'reply target must be in the same channel' using errcode = '23514';
  end if;

  if v_rate > 0 and not public.has_channel_permission(new.channel_id, public.permission_bit('MANAGE_MESSAGES')) then
    select max(m.created_at) into v_last_sent
      from public.messages m
     where m.channel_id = new.channel_id and m.author_id = new.author_id;
    if v_last_sent is not null and v_last_sent > now() - make_interval(secs => v_rate) then
      raise exception 'slow mode: wait % seconds between messages', v_rate using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.validate_message_insert();

create or replace function public.validate_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel_id <> old.channel_id
     or new.author_id is distinct from old.author_id
     or new.created_at <> old.created_at
     or new.reply_to_id is distinct from old.reply_to_id then
    raise exception 'immutable message fields cannot change' using errcode = '23514';
  end if;

  if new.content is distinct from old.content or new.attachments is distinct from old.attachments then
    if old.author_id is distinct from auth.uid() then
      raise exception 'only the author can edit a message' using errcode = '42501';
    end if;
    new.edited_at := now();
  end if;

  if new.pinned is distinct from old.pinned
     and not public.has_channel_permission(old.channel_id, public.permission_bit('MANAGE_MESSAGES')) then
    raise exception 'MANAGE_MESSAGES required to pin' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger messages_before_update
  before update on public.messages
  for each row execute function public.validate_message_update();

-- 4.5 Guard against the owner leaving / being kicked, and against role-grant via member_roles -----
create or replace function public.protect_server_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.servers s where s.id = old.server_id and s.owner_id = old.user_id) then
    raise exception 'the server owner cannot leave or be removed; delete or transfer the server instead'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger server_members_protect_owner
  before delete on public.server_members
  for each row
  when (pg_trigger_depth() = 0)   -- allow cascades from deleting the whole server
  execute function public.protect_server_owner_membership();

create or replace function public.validate_member_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.server_roles r where r.id = new.role_id and r.is_default) then
    raise exception '@everyone is implicit and cannot be assigned' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger member_roles_validate
  before insert on public.member_roles
  for each row execute function public.validate_member_role();

-- -------------------------------------------------------------------------------------
-- 5. RPCs
-- -------------------------------------------------------------------------------------

-- Join a server through an invite code. Returns the server id.
create or replace function public.join_server(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_invite public.server_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_invite from public.server_invites where code = p_code for update;
  if not found then
    raise exception 'invalid invite' using errcode = 'P0002';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite expired' using errcode = 'P0001';
  end if;
  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'invite exhausted' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.server_bans b where b.server_id = v_invite.server_id and b.user_id = v_uid) then
    raise exception 'you are banned from this server' using errcode = '42501';
  end if;

  insert into public.server_members (server_id, user_id)
  values (v_invite.server_id, v_uid)
  on conflict do nothing;

  if found then
    update public.server_invites set uses = uses + 1 where code = p_code;
  end if;
  return v_invite.server_id;
end;
$$;

-- Preview an invite (server name/icon/member count) before joining.
create or replace function public.preview_invite(p_code text)
returns table (server_id uuid, name text, icon_url text, member_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.icon_url, (select count(*) from public.server_members m where m.server_id = s.id)
    from public.server_invites i
    join public.servers s on s.id = i.server_id
   where i.code = p_code
     and (i.expires_at is null or i.expires_at > now())
     and (i.max_uses is null or i.uses < i.max_uses)
$$;

-- Ban = remove membership + record ban, atomically and with hierarchy checks.
create or replace function public.ban_member(p_server_id uuid, p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  delete from public.server_members where server_id = p_server_id and user_id = p_user_id;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 6. Privileges (column-level GRANTs: the second line of defence behind RLS)
-- -------------------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.users to authenticated;
grant update (username, display_name, custom_status, status_emoji, bio, avatar_url, avatar_frame,
              banner_url, primary_color, accent_color, custom_css, audio_status_url, theme_preset)
  on public.users to authenticated;          -- badge_ids deliberately excluded

grant select, delete on public.servers to authenticated;
grant insert (name, description, icon_url, banner_url) on public.servers to authenticated;
grant update (name, description, icon_url, banner_url) on public.servers to authenticated;

grant select, delete on public.server_members to authenticated;
grant update (nickname) on public.server_members to authenticated;

grant select, delete on public.server_bans to authenticated;

grant select, delete on public.server_roles to authenticated;
grant insert (server_id, name, color, position, permissions, hoist, mentionable) on public.server_roles to authenticated;
grant update (name, color, position, permissions, hoist, mentionable) on public.server_roles to authenticated;

grant select, insert, delete on public.member_roles to authenticated;

grant select, delete on public.channels to authenticated;
grant insert (server_id, parent_id, type, name, topic, position, rate_limit_seconds, user_limit) on public.channels to authenticated;
grant update (parent_id, name, topic, position, rate_limit_seconds, user_limit) on public.channels to authenticated;

grant select, insert, update, delete on public.channel_overwrites to authenticated;

grant select, delete on public.messages to authenticated;
grant insert (channel_id, content, attachments, reply_to_id) on public.messages to authenticated;
grant update (content, attachments, pinned) on public.messages to authenticated;

grant select, delete on public.server_invites to authenticated;
grant insert (server_id, max_uses, expires_at) on public.server_invites to authenticated;

grant execute on function
  public.permission_bit(text),
  public.all_permissions(),
  public.default_everyone_permissions(),
  public.try_uuid(text),
  public.is_valid_attachments(jsonb),
  public.is_valid_badge_ids(jsonb),
  public.is_server_member(uuid),
  public.server_permissions(uuid, uuid),
  public.channel_permissions(uuid, uuid),
  public.has_server_permission(uuid, bigint),
  public.has_channel_permission(uuid, bigint),
  public.member_top_position(uuid, uuid),
  public.can_join_voice_topic(text),
  public.join_server(text),
  public.preview_invite(text),
  public.ban_member(uuid, uuid, text)
to authenticated;

-- -------------------------------------------------------------------------------------
-- 7. Row-Level Security
-- -------------------------------------------------------------------------------------
alter table public.users              enable row level security;
alter table public.servers            enable row level security;
alter table public.server_members     enable row level security;
alter table public.server_bans        enable row level security;
alter table public.server_roles       enable row level security;
alter table public.member_roles       enable row level security;
alter table public.channels           enable row level security;
alter table public.channel_overwrites enable row level security;
alter table public.messages           enable row level security;
alter table public.server_invites     enable row level security;

-- 7.1 users ------------------------------------------------------------------------------
create policy "users: any signed-in user can read profiles"
  on public.users for select to authenticated
  using (true);

create policy "users: update own profile"
  on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 7.2 servers ----------------------------------------------------------------------------
create policy "servers: members can read"
  on public.servers for select to authenticated
  using (public.is_server_member(id) or owner_id = (select auth.uid()));

create policy "servers: anyone can create a server they own"
  on public.servers for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "servers: MANAGE_SERVER can edit"
  on public.servers for update to authenticated
  using (public.has_server_permission(id, public.permission_bit('MANAGE_SERVER')))
  with check (public.has_server_permission(id, public.permission_bit('MANAGE_SERVER')));

create policy "servers: owner can delete"
  on public.servers for delete to authenticated
  using (owner_id = (select auth.uid()));

-- 7.3 server_members ---------------------------------------------------------------------
create policy "members: visible to fellow members"
  on public.server_members for select to authenticated
  using (public.is_server_member(server_id));

create policy "members: leave, or kick lower-ranked members"
  on public.server_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (
      public.has_server_permission(server_id, public.permission_bit('KICK_MEMBERS'))
      and public.member_top_position(server_id, user_id) < public.member_top_position(server_id, (select auth.uid()))
    )
  );

create policy "members: change own nickname"
  on public.server_members for update to authenticated
  using (
    user_id = (select auth.uid())
    and public.has_server_permission(server_id, public.permission_bit('CHANGE_NICKNAME'))
  )
  with check (user_id = (select auth.uid()));

-- 7.4 server_bans --------------------------------------------------------------------------
create policy "bans: BAN_MEMBERS can read"
  on public.server_bans for select to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('BAN_MEMBERS')));

create policy "bans: BAN_MEMBERS can lift"
  on public.server_bans for delete to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('BAN_MEMBERS')));

-- 7.5 server_roles -------------------------------------------------------------------------
create policy "roles: visible to members"
  on public.server_roles for select to authenticated
  using (public.is_server_member(server_id));

create policy "roles: MANAGE_ROLES can create below own rank, without escalating"
  on public.server_roles for insert to authenticated
  with check (
    not is_default
    and public.has_server_permission(server_id, public.permission_bit('MANAGE_ROLES'))
    and position < public.member_top_position(server_id, (select auth.uid()))
    and (permissions & ~public.server_permissions(server_id, (select auth.uid()))) = 0
  );

create policy "roles: MANAGE_ROLES can edit below own rank, without escalating"
  on public.server_roles for update to authenticated
  using (
    public.has_server_permission(server_id, public.permission_bit('MANAGE_ROLES'))
    and position < public.member_top_position(server_id, (select auth.uid()))
  )
  with check (
    public.has_server_permission(server_id, public.permission_bit('MANAGE_ROLES'))
    and (is_default = (position = 0))
    and (is_default or position >= 1)
    and position < public.member_top_position(server_id, (select auth.uid()))
    and (permissions & ~public.server_permissions(server_id, (select auth.uid()))) = 0
  );

create policy "roles: MANAGE_ROLES can delete non-default roles below own rank"
  on public.server_roles for delete to authenticated
  using (
    not is_default
    and public.has_server_permission(server_id, public.permission_bit('MANAGE_ROLES'))
    and position < public.member_top_position(server_id, (select auth.uid()))
  );

-- 7.6 member_roles ---------------------------------------------------------------------------
create policy "member_roles: visible to members"
  on public.member_roles for select to authenticated
  using (public.is_server_member(server_id));

create policy "member_roles: MANAGE_ROLES can assign roles below own rank"
  on public.member_roles for insert to authenticated
  with check (
    public.has_server_permission(server_id, public.permission_bit('MANAGE_ROLES'))
    and exists (
      select 1 from public.server_roles r
       where r.id = role_id
         and r.server_id = member_roles.server_id
         and r.position < public.member_top_position(r.server_id, (select auth.uid()))
    )
  );

create policy "member_roles: MANAGE_ROLES can revoke roles below own rank"
  on public.member_roles for delete to authenticated
  using (
    public.has_server_permission(server_id, public.permission_bit('MANAGE_ROLES'))
    and exists (
      select 1 from public.server_roles r
       where r.id = role_id
         and r.position < public.member_top_position(r.server_id, (select auth.uid()))
    )
  );

-- 7.7 channels ----------------------------------------------------------------------------
create policy "channels: VIEW_CHANNEL required"
  on public.channels for select to authenticated
  using (public.has_channel_permission(id, public.permission_bit('VIEW_CHANNEL')));

create policy "channels: MANAGE_CHANNELS can create"
  on public.channels for insert to authenticated
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_CHANNELS')));

create policy "channels: MANAGE_CHANNELS can edit"
  on public.channels for update to authenticated
  using (public.has_channel_permission(id, public.permission_bit('MANAGE_CHANNELS')))
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_CHANNELS')));

create policy "channels: MANAGE_CHANNELS can delete"
  on public.channels for delete to authenticated
  using (public.has_channel_permission(id, public.permission_bit('MANAGE_CHANNELS')));

-- 7.8 channel_overwrites -------------------------------------------------------------------------
create policy "overwrites: visible to anyone who can view the channel"
  on public.channel_overwrites for select to authenticated
  using (public.has_channel_permission(channel_id, public.permission_bit('VIEW_CHANNEL')));

create policy "overwrites: MANAGE_ROLES can create without escalating"
  on public.channel_overwrites for insert to authenticated
  with check (
    public.has_channel_permission(channel_id, public.permission_bit('MANAGE_ROLES'))
    and (allow & ~public.channel_permissions(channel_id, (select auth.uid()))) = 0
  );

create policy "overwrites: MANAGE_ROLES can edit without escalating"
  on public.channel_overwrites for update to authenticated
  using (public.has_channel_permission(channel_id, public.permission_bit('MANAGE_ROLES')))
  with check (
    public.has_channel_permission(channel_id, public.permission_bit('MANAGE_ROLES'))
    and (allow & ~public.channel_permissions(channel_id, (select auth.uid()))) = 0
  );

create policy "overwrites: MANAGE_ROLES can delete"
  on public.channel_overwrites for delete to authenticated
  using (public.has_channel_permission(channel_id, public.permission_bit('MANAGE_ROLES')));

-- 7.9 messages ----------------------------------------------------------------------------------
create policy "messages: VIEW_CHANNEL required to read"
  on public.messages for select to authenticated
  using (public.has_channel_permission(channel_id, public.permission_bit('VIEW_CHANNEL')));

create policy "messages: SEND_MESSAGES (+ATTACH_FILES for attachments) to post"
  on public.messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.has_channel_permission(channel_id, public.permission_bit('SEND_MESSAGES'))
    and (
      jsonb_array_length(attachments) = 0
      or public.has_channel_permission(channel_id, public.permission_bit('ATTACH_FILES'))
    )
  );

-- Edit rules (author-only content, MANAGE_MESSAGES for pins) are enforced in validate_message_update().
create policy "messages: author or MANAGE_MESSAGES can update"
  on public.messages for update to authenticated
  using (
    author_id = (select auth.uid())
    or public.has_channel_permission(channel_id, public.permission_bit('MANAGE_MESSAGES'))
  )
  with check (public.has_channel_permission(channel_id, public.permission_bit('VIEW_CHANNEL')));

create policy "messages: author or MANAGE_MESSAGES can delete"
  on public.messages for delete to authenticated
  using (
    author_id = (select auth.uid())
    or public.has_channel_permission(channel_id, public.permission_bit('MANAGE_MESSAGES'))
  );

-- 7.10 server_invites ------------------------------------------------------------------------------
create policy "invites: CREATE_INVITE can list"
  on public.server_invites for select to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('CREATE_INVITE')));

create policy "invites: CREATE_INVITE can create"
  on public.server_invites for insert to authenticated
  with check (
    creator_id = (select auth.uid())
    and public.has_server_permission(server_id, public.permission_bit('CREATE_INVITE'))
  );

create policy "invites: creator or MANAGE_SERVER can revoke"
  on public.server_invites for delete to authenticated
  using (
    creator_id = (select auth.uid())
    or public.has_server_permission(server_id, public.permission_bit('MANAGE_SERVER'))
  );

-- -------------------------------------------------------------------------------------
-- 8. Realtime
-- -------------------------------------------------------------------------------------
-- Message fan-out via postgres_changes (Realtime re-checks the SELECT policy per subscriber).
alter publication supabase_realtime add table public.messages;

-- Private voice rooms (Realtime Authorization). Topic format: voice:<channel uuid>
create policy "realtime: voice room receive requires CONNECT"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_join_voice_topic((select realtime.topic()))
  );

create policy "realtime: voice room send requires CONNECT"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_join_voice_topic((select realtime.topic()))
  );

-- -------------------------------------------------------------------------------------
-- 9. Storage
-- -------------------------------------------------------------------------------------
--   attachments/<channel_id>/<uuid>/<filename>   private, 25 MB, gated by channel perms
--   profile-media/<user_id>/<filename>           public read, owner write, 8 MB
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400),
       ('profile-media', 'profile-media', true, 8388608)
on conflict (id) do nothing;

create policy "storage: read attachments with VIEW_CHANNEL"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_channel_permission(public.try_uuid((storage.foldername(name))[1]), public.permission_bit('VIEW_CHANNEL'))
  );

create policy "storage: upload attachments with ATTACH_FILES"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.has_channel_permission(public.try_uuid((storage.foldername(name))[1]), public.permission_bit('ATTACH_FILES'))
  );

create policy "storage: uploader or MANAGE_MESSAGES can delete attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      owner_id = (select auth.uid())::text
      or public.has_channel_permission(public.try_uuid((storage.foldername(name))[1]), public.permission_bit('MANAGE_MESSAGES'))
    )
  );

create policy "storage: users manage their own profile media (insert)"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "storage: users manage their own profile media (update)"
  on storage.objects for update to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "storage: users manage their own profile media (delete)"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
