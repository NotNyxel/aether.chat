-- aether.chat Batch 4: voice & video upgrades + profile customization (v0.7.0)
--   * voice_states: who is in which server voice/stage channel (live occupancy, LIVE badges)
--   * moderator voice tools: server mute / deafen, move, disconnect (audited)
--   * stage channels (channel type 'stream'): speakers vs audience, raise hand, invite to speak
--   * soundboard: per-server sounds in a public storage bucket
--   * permissions: USE_SOUNDBOARD (22), MANAGE_EXPRESSIONS (23), REQUEST_TO_SPEAK (24)
--   * profiles: pronouns, name font/effect/colours, profile effect, card style, avatar shape, links,
--     and any theme preset id
-- Run after 005_notifications.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Permissions
-- -------------------------------------------------------------------------------------------
create or replace function public.permission_bit(p_name text)
returns bigint language sql immutable parallel safe set search_path = '' as $$
  select case p_name
    when 'VIEW_CHANNEL'       then 1::bigint << 0
    when 'SEND_MESSAGES'      then 1::bigint << 1
    when 'ATTACH_FILES'       then 1::bigint << 2
    when 'MANAGE_MESSAGES'    then 1::bigint << 3
    when 'MENTION_EVERYONE'   then 1::bigint << 4
    when 'CONNECT'            then 1::bigint << 5
    when 'SPEAK'              then 1::bigint << 6
    when 'STREAM'             then 1::bigint << 7
    when 'MUTE_MEMBERS'       then 1::bigint << 8
    when 'DEAFEN_MEMBERS'     then 1::bigint << 9
    when 'MOVE_MEMBERS'       then 1::bigint << 10
    when 'MANAGE_CHANNELS'    then 1::bigint << 11
    when 'MANAGE_ROLES'       then 1::bigint << 12
    when 'MANAGE_SERVER'      then 1::bigint << 13
    when 'CREATE_INVITE'      then 1::bigint << 14
    when 'KICK_MEMBERS'       then 1::bigint << 15
    when 'BAN_MEMBERS'        then 1::bigint << 16
    when 'CHANGE_NICKNAME'    then 1::bigint << 17
    when 'ADMINISTRATOR'      then 1::bigint << 18
    when 'MANAGE_NICKNAMES'   then 1::bigint << 19
    when 'MODERATE_MEMBERS'   then 1::bigint << 20
    when 'VIEW_AUDIT_LOG'     then 1::bigint << 21
    when 'USE_SOUNDBOARD'     then 1::bigint << 22
    when 'MANAGE_EXPRESSIONS' then 1::bigint << 23
    when 'REQUEST_TO_SPEAK'   then 1::bigint << 24
  end
$$;

create or replace function public.all_permissions()
returns bigint language sql immutable parallel safe set search_path = '' as $$ select (1::bigint << 25) - 1 $$;

-- @everyone gets soundboard and request-to-speak by default (new servers and existing ones).
create or replace function public.default_everyone_permissions()
returns bigint language sql immutable parallel safe set search_path = '' as $$
  select 147687::bigint | (1::bigint << 22) | (1::bigint << 24)
$$;

update public.server_roles
   set permissions = permissions | (1::bigint << 22) | (1::bigint << 24)
 where is_default;

-- -------------------------------------------------------------------------------------------
-- 2. Voice states (server voice and stage channels only; DM calls don't use this)
-- -------------------------------------------------------------------------------------------
create table if not exists public.voice_states (
  user_id             uuid primary key default auth.uid() references public.users (id) on delete cascade,
  channel_id          uuid not null references public.channels (id) on delete cascade,
  server_id           uuid not null references public.servers (id) on delete cascade,
  self_mute           boolean not null default false,
  self_deaf           boolean not null default false,
  streaming           boolean not null default false,
  camera              boolean not null default false,
  server_mute         boolean not null default false,
  server_deaf         boolean not null default false,
  -- Stage audience member (can listen, can't speak).
  suppressed          boolean not null default false,
  request_to_speak_at timestamptz,
  joined_at           timestamptz not null default now(),
  -- Heartbeat. Rows older than 90 seconds are treated as gone (crashed clients).
  updated_at          timestamptz not null default now()
);
create index if not exists voice_states_channel_idx on public.voice_states (channel_id);
create index if not exists voice_states_server_idx on public.voice_states (server_id);

alter table public.voice_states enable row level security;
drop policy if exists voice_states_read on public.voice_states;
create policy voice_states_read on public.voice_states
  for select to authenticated
  using (public.is_server_member(server_id));
-- All writes go through the RPCs below.
revoke all on public.voice_states from anon, authenticated;
grant select on public.voice_states to authenticated;

-- Realtime: live occupancy for everyone in the server.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_states') then
    alter publication supabase_realtime add table public.voice_states;
  end if;
end $$;

create or replace function public.voice_live(p_row public.voice_states)
returns boolean language sql stable set search_path = '' as $$
  select p_row.updated_at > now() - interval '90 seconds'
$$;

-- Joins (or switches to) a server voice / stage channel.
create or replace function public.voice_join(p_channel_id uuid)
returns public.voice_states
language plpgsql security definer set search_path = '' as $$
declare
  v_ch     public.channels;
  v_prev   public.voice_states;
  v_count  integer;
  v_row    public.voice_states;
  v_is_mod boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  select * into v_ch from public.channels where id = p_channel_id;
  if v_ch.id is null or v_ch.type not in ('voice', 'stream') then
    raise exception 'Not a voice channel.' using errcode = '22023';
  end if;
  if not public.has_channel_permission(p_channel_id, public.permission_bit('CONNECT')) then
    raise exception 'You don''t have permission to connect to this channel.' using errcode = '42501';
  end if;
  if public.is_timed_out(v_ch.server_id) then
    raise exception 'You are timed out in this server.' using errcode = '42501';
  end if;

  -- Forget crashed clients in this channel.
  delete from public.voice_states where channel_id = p_channel_id and updated_at < now() - interval '90 seconds';

  if v_ch.user_limit is not null
     and not public.has_channel_permission(p_channel_id, public.permission_bit('MOVE_MEMBERS')) then
    select count(*) into v_count from public.voice_states
     where channel_id = p_channel_id and user_id <> auth.uid();
    if v_count >= v_ch.user_limit then
      raise exception 'This channel is full.' using errcode = '53400';
    end if;
  end if;

  v_is_mod := public.has_channel_permission(p_channel_id, public.permission_bit('MUTE_MEMBERS'));
  select * into v_prev from public.voice_states where user_id = auth.uid();

  insert into public.voice_states as vs (user_id, channel_id, server_id, server_mute, server_deaf, suppressed)
  values (
    auth.uid(), p_channel_id, v_ch.server_id,
    -- server mute/deafen follow you around the same server, like Discord
    coalesce(v_prev.server_id = v_ch.server_id and v_prev.server_mute, false),
    coalesce(v_prev.server_id = v_ch.server_id and v_prev.server_deaf, false),
    v_ch.type = 'stream' and not v_is_mod
  )
  on conflict (user_id) do update
    set channel_id = excluded.channel_id, server_id = excluded.server_id,
        server_mute = excluded.server_mute, server_deaf = excluded.server_deaf,
        suppressed = excluded.suppressed, request_to_speak_at = null,
        streaming = false, camera = false, joined_at = now(), updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- Own state + heartbeat (call every ~30 s while connected).
create or replace function public.voice_update(p_self_mute boolean, p_self_deaf boolean, p_streaming boolean, p_camera boolean)
returns void language sql security definer set search_path = '' as $$
  update public.voice_states
     set self_mute = p_self_mute, self_deaf = p_self_deaf, streaming = p_streaming, camera = p_camera, updated_at = now()
   where user_id = auth.uid()
$$;

create or replace function public.voice_leave()
returns void language sql security definer set search_path = '' as $$
  delete from public.voice_states where user_id = auth.uid()
$$;

-- Stage: raise or lower your hand.
create or replace function public.stage_request_to_speak(p_raise boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.voice_states;
begin
  select * into v_row from public.voice_states where user_id = auth.uid();
  if v_row.user_id is null then raise exception 'You''re not in a stage.' using errcode = '22023'; end if;
  if p_raise and not public.has_channel_permission(v_row.channel_id, public.permission_bit('REQUEST_TO_SPEAK')) then
    raise exception 'You don''t have permission to request to speak.' using errcode = '42501';
  end if;
  update public.voice_states set request_to_speak_at = case when p_raise then now() end where user_id = auth.uid();
end;
$$;

-- Stage: make someone a speaker or move them to the audience. Anyone may step down themselves.
create or replace function public.stage_set_speaker(p_user_id uuid, p_speaker boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.voice_states;
begin
  select * into v_row from public.voice_states where user_id = p_user_id;
  if v_row.user_id is null then raise exception 'They''re not in a stage.' using errcode = '22023'; end if;
  if not (p_user_id = auth.uid() and not p_speaker)
     and not public.has_channel_permission(v_row.channel_id, public.permission_bit('MUTE_MEMBERS')) then
    raise exception 'Only stage moderators (Mute Members) can do that.' using errcode = '42501';
  end if;
  update public.voice_states set suppressed = not p_speaker, request_to_speak_at = null where user_id = p_user_id;
end;
$$;

-- Server mute / deafen. null leaves a flag unchanged.
create or replace function public.voice_moderate(p_user_id uuid, p_server_mute boolean, p_server_deaf boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row  public.voice_states;
  v_name text;
begin
  select * into v_row from public.voice_states where user_id = p_user_id;
  if v_row.user_id is null then raise exception 'They''re not in voice.' using errcode = '22023'; end if;
  if p_server_mute is not null and not public.has_channel_permission(v_row.channel_id, public.permission_bit('MUTE_MEMBERS')) then
    raise exception 'You need the Mute Members permission.' using errcode = '42501';
  end if;
  if p_server_deaf is not null and not public.has_channel_permission(v_row.channel_id, public.permission_bit('DEAFEN_MEMBERS')) then
    raise exception 'You need the Deafen Members permission.' using errcode = '42501';
  end if;
  if exists (select 1 from public.servers s where s.id = v_row.server_id and s.owner_id = p_user_id) and p_user_id <> auth.uid() then
    raise exception 'You can''t moderate the server owner.' using errcode = '42501';
  end if;
  update public.voice_states
     set server_mute = coalesce(p_server_mute, server_mute), server_deaf = coalesce(p_server_deaf, server_deaf)
   where user_id = p_user_id;
  select coalesce(u.display_name, u.username::text) into v_name from public.users u where u.id = p_user_id;
  if p_server_mute is not null and p_server_mute is distinct from v_row.server_mute then
    perform public.write_audit(v_row.server_id, case when p_server_mute then 'voice_server_mute' else 'voice_server_unmute' end, 'member', p_user_id, v_name);
  end if;
  if p_server_deaf is not null and p_server_deaf is distinct from v_row.server_deaf then
    perform public.write_audit(v_row.server_id, case when p_server_deaf then 'voice_server_deafen' else 'voice_server_undeafen' end, 'member', p_user_id, v_name);
  end if;
end;
$$;

-- Move someone to another voice channel in the same server (MOVE_MEMBERS on both channels).
create or replace function public.voice_move(p_user_id uuid, p_channel_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row  public.voice_states;
  v_ch   public.channels;
  v_name text;
begin
  select * into v_row from public.voice_states where user_id = p_user_id;
  if v_row.user_id is null then raise exception 'They''re not in voice.' using errcode = '22023'; end if;
  select * into v_ch from public.channels where id = p_channel_id;
  if v_ch.id is null or v_ch.type not in ('voice', 'stream') or v_ch.server_id <> v_row.server_id then
    raise exception 'Pick a voice channel in the same server.' using errcode = '22023';
  end if;
  if not public.has_channel_permission(v_row.channel_id, public.permission_bit('MOVE_MEMBERS'))
     or not public.has_channel_permission(p_channel_id, public.permission_bit('MOVE_MEMBERS')) then
    raise exception 'You need the Move Members permission in both channels.' using errcode = '42501';
  end if;
  update public.voice_states
     set channel_id = p_channel_id, suppressed = v_ch.type = 'stream', request_to_speak_at = null, updated_at = now()
   where user_id = p_user_id;
  select coalesce(u.display_name, u.username::text) into v_name from public.users u where u.id = p_user_id;
  perform public.write_audit(v_row.server_id, 'voice_move', 'member', p_user_id, v_name, jsonb_build_object('to', v_ch.name));
end;
$$;

-- Disconnect someone from voice. Their client leaves; everyone else stops playing their audio.
create or replace function public.voice_disconnect(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row  public.voice_states;
  v_name text;
begin
  select * into v_row from public.voice_states where user_id = p_user_id;
  if v_row.user_id is null then return; end if;
  if p_user_id <> auth.uid() and not public.has_channel_permission(v_row.channel_id, public.permission_bit('MOVE_MEMBERS')) then
    raise exception 'You need the Move Members permission.' using errcode = '42501';
  end if;
  delete from public.voice_states where user_id = p_user_id;
  if p_user_id <> auth.uid() then
    select coalesce(u.display_name, u.username::text) into v_name from public.users u where u.id = p_user_id;
    perform public.write_audit(v_row.server_id, 'voice_disconnect', 'member', p_user_id, v_name);
  end if;
end;
$$;

-- Leaving the server (kick, ban, leave) also leaves its voice.
create or replace function public.voice_states_cleanup_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.voice_states where user_id = old.user_id and server_id = old.server_id;
  return old;
end;
$$;
drop trigger if exists server_members_voice_cleanup on public.server_members;
create trigger server_members_voice_cleanup after delete on public.server_members
  for each row execute function public.voice_states_cleanup_member();

-- -------------------------------------------------------------------------------------------
-- 3. Soundboard
-- -------------------------------------------------------------------------------------------
create table if not exists public.soundboard_sounds (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid not null references public.servers (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 32),
  emoji      text check (char_length(emoji) <= 16),
  url        text not null check (url ~ '^https://'),
  volume     real not null default 1 check (volume between 0 and 1),
  created_by uuid default auth.uid() references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists soundboard_sounds_server_idx on public.soundboard_sounds (server_id);

alter table public.soundboard_sounds enable row level security;
drop policy if exists soundboard_read on public.soundboard_sounds;
create policy soundboard_read on public.soundboard_sounds for select to authenticated
  using (public.is_server_member(server_id));
drop policy if exists soundboard_insert on public.soundboard_sounds;
create policy soundboard_insert on public.soundboard_sounds for insert to authenticated
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS'))
              and (select count(*) from public.soundboard_sounds s where s.server_id = soundboard_sounds.server_id) < 48);
drop policy if exists soundboard_update on public.soundboard_sounds;
create policy soundboard_update on public.soundboard_sounds for update to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS')))
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS')));
drop policy if exists soundboard_delete on public.soundboard_sounds;
create policy soundboard_delete on public.soundboard_sounds for delete to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS')));

revoke all on public.soundboard_sounds from anon;
grant select, delete on public.soundboard_sounds to authenticated;
grant insert (server_id, name, emoji, url, volume) on public.soundboard_sounds to authenticated;
grant update (name, emoji, volume) on public.soundboard_sounds to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('soundboard', 'soundboard', true, 1048576)
on conflict (id) do nothing;

drop policy if exists "storage: soundboard upload with MANAGE_EXPRESSIONS" on storage.objects;
create policy "storage: soundboard upload with MANAGE_EXPRESSIONS"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'soundboard'
    and public.has_server_permission(public.try_uuid((storage.foldername(name))[1]), public.permission_bit('MANAGE_EXPRESSIONS'))
  );
drop policy if exists "storage: soundboard delete with MANAGE_EXPRESSIONS" on storage.objects;
create policy "storage: soundboard delete with MANAGE_EXPRESSIONS"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'soundboard'
    and public.has_server_permission(public.try_uuid((storage.foldername(name))[1]), public.permission_bit('MANAGE_EXPRESSIONS'))
  );

-- Audit soundboard changes like other server settings.
create or replace function public.soundboard_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row public.soundboard_sounds := coalesce(new, old);
begin
  perform public.write_audit(v_row.server_id,
    'sound_' || case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    'sound', v_row.id, v_row.name);
  return null;
end;
$$;
drop trigger if exists soundboard_audit on public.soundboard_sounds;
create trigger soundboard_audit after insert or update or delete on public.soundboard_sounds
  for each row execute function public.soundboard_audit();

-- -------------------------------------------------------------------------------------------
-- 4. Profile customization
-- -------------------------------------------------------------------------------------------
create or replace function public.is_valid_profile_links(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 5
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or char_length(coalesce(e ->> 'label', '')) not between 1 and 32
           or coalesce(e ->> 'url', '') !~ '^https://[^[:space:]]+$'
           or char_length(e ->> 'url') > 256
     )
$$;

alter table public.users
  add column if not exists pronouns       text check (char_length(pronouns) <= 40),
  add column if not exists name_font      text not null default 'default'
    check (name_font in ('default', 'serif', 'mono', 'rounded', 'display', 'handwritten', 'pixel')),
  add column if not exists name_effect    text not null default 'none'
    check (name_effect in ('none', 'gradient', 'rainbow', 'glow', 'neon', 'shimmer')),
  add column if not exists name_color_a   text check (name_color_a ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists name_color_b   text check (name_color_b ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists profile_effect text not null default 'none'
    check (profile_effect in ('none', 'sparkles', 'snow', 'hearts', 'fireflies', 'confetti', 'rain', 'stars', 'bubbles', 'petals')),
  add column if not exists card_style     text not null default 'solid'
    check (card_style in ('solid', 'glass', 'gradient', 'aurora')),
  add column if not exists avatar_shape   text not null default 'circle'
    check (avatar_shape in ('circle', 'squircle', 'hexagon')),
  add column if not exists profile_links  jsonb not null default '[]'::jsonb
    check (public.is_valid_profile_links(profile_links));

grant update (pronouns, name_font, name_effect, name_color_a, name_color_b, profile_effect, card_style, avatar_shape, profile_links)
  on public.users to authenticated;

-- Any theme preset id (the app ships many more now).
alter table public.users drop constraint if exists users_theme_preset_check;
alter table public.users add constraint users_theme_preset_check check (theme_preset ~ '^[a-z0-9-]{1,32}$');

-- -------------------------------------------------------------------------------------------
-- 5. Function privileges
-- -------------------------------------------------------------------------------------------
revoke all on function public.voice_join(uuid), public.voice_update(boolean, boolean, boolean, boolean), public.voice_leave(),
                       public.stage_request_to_speak(boolean), public.stage_set_speaker(uuid, boolean),
                       public.voice_moderate(uuid, boolean, boolean), public.voice_move(uuid, uuid), public.voice_disconnect(uuid)
  from public, anon;
grant execute on function public.voice_join(uuid), public.voice_update(boolean, boolean, boolean, boolean), public.voice_leave(),
                          public.stage_request_to_speak(boolean), public.stage_set_speaker(uuid, boolean),
                          public.voice_moderate(uuid, boolean, boolean), public.voice_move(uuid, uuid), public.voice_disconnect(uuid)
  to authenticated;
