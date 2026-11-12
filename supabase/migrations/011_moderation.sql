-- aether.chat 1.1: platform moderation (admin panel)
--   * account bans: timed or permanent, with appeals; a banned account can still sign in, but only
--     sees its ban and the appeal form (every table gets a restrictive RLS policy, and a trigger
--     stops writes made through SECURITY DEFINER functions)
--   * warnings with account standing ("danger level"): each warning carries points that expire;
--     admins can add, edit, revoke and delete warnings, or pin a level by hand
--   * admins can edit a user's username, display name, bio and images, and delete accounts
--     (email and password changes go through the admin-user Edge Function, which uses the auth API)
--   * an admin audit log of every action
-- Run after 010_invites.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Tables
-- -------------------------------------------------------------------------------------------
create table if not exists public.user_bans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  reason      text not null check (char_length(btrim(reason)) between 1 and 500),
  issued_by   uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,                    -- null = permanent
  lifted_at   timestamptz,
  lifted_by   uuid references public.users (id) on delete set null,
  lift_reason text check (char_length(lift_reason) <= 500)
);
create index if not exists user_bans_user_idx on public.user_bans (user_id, created_at desc);

create table if not exists public.ban_appeals (
  id          uuid primary key default gen_random_uuid(),
  ban_id      uuid not null references public.user_bans (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  message     text not null check (char_length(btrim(message)) between 10 and 2000),
  status      text not null default 'open' check (status in ('open', 'accepted', 'denied')),
  response    text check (char_length(response) <= 1000),
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists ban_appeals_one_open on public.ban_appeals (ban_id) where status = 'open';

create table if not exists public.user_warnings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  category        text not null check (category in ('spam', 'harassment', 'hate', 'nsfw', 'scam', 'impersonation', 'self_harm', 'violence', 'evasion', 'other')),
  details         text check (char_length(details) <= 1000),
  severity        smallint not null check (severity between 1 and 4),   -- points toward the danger level
  issued_by       uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,                                         -- null = never expires
  revoked_at      timestamptz,
  revoked_by      uuid references public.users (id) on delete set null,
  acknowledged_at timestamptz
);
create index if not exists user_warnings_user_idx on public.user_warnings (user_id, created_at desc);

-- A hand-set danger level that overrides the computed one (null = computed from warnings).
create table if not exists public.user_standing (
  user_id    uuid primary key references public.users (id) on delete cascade,
  override   text check (override in ('good', 'low', 'medium', 'high', 'critical')),
  note       text check (char_length(note) <= 1000),
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.users (id) on delete set null,
  action     text not null,
  target_id  uuid,                -- not a foreign key: deleted users stay in the log
  target_name text,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);
create index if not exists admin_audit_target_idx on public.admin_audit (target_id, created_at desc);

alter table public.user_bans enable row level security;
alter table public.ban_appeals enable row level security;
alter table public.user_warnings enable row level security;
alter table public.user_standing enable row level security;
alter table public.admin_audit enable row level security;
revoke all on public.user_bans, public.ban_appeals, public.user_warnings, public.user_standing, public.admin_audit from anon, authenticated;
-- Everything goes through the RPCs below; admins read through them too.

-- -------------------------------------------------------------------------------------------
-- 2. Helpers
-- -------------------------------------------------------------------------------------------
create or replace function public.is_banned(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.user_bans b
     where b.user_id = p_user and b.lifted_at is null and (b.expires_at is null or b.expires_at > now())
  )
$$;

create or replace function public.warning_points(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(w.severity), 0)::integer from public.user_warnings w
   where w.user_id = p_user and w.revoked_at is null and (w.expires_at is null or w.expires_at > now())
$$;

-- good (0) · low (1–2) · medium (3–4) · high (5–7) · critical (8+), unless an admin pinned a level.
create or replace function public.danger_level(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.override from public.user_standing s where s.user_id = p_user),
    case
      when public.warning_points(p_user) = 0 then 'good'
      when public.warning_points(p_user) <= 2 then 'low'
      when public.warning_points(p_user) <= 4 then 'medium'
      when public.warning_points(p_user) <= 7 then 'high'
      else 'critical'
    end)
$$;

create or replace function public.admin_log(p_action text, p_target uuid, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit (actor_id, action, target_id, target_name, details)
  values (auth.uid(), p_action, p_target, (select u.username::text from public.users u where u.id = p_target), coalesce(p_details, '{}'::jsonb))
$$;

-- Admin actions on another account: not yourself, and not another admin (remove their admin first).
create or replace function public.admin_require_target(p_user uuid, p_allow_admins boolean default false)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  if not exists (select 1 from public.users where id = p_user) then
    raise exception 'That account doesn''t exist.' using errcode = 'P0002';
  end if;
  if p_user = auth.uid() then raise exception 'You can''t do that to your own account.' using errcode = '22023'; end if;
  if not p_allow_admins and public.is_app_admin(p_user) then
    raise exception 'That account is an admin. Remove their admin access first.' using errcode = '42501';
  end if;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 3. Enforcement: banned accounts can't read or write anything else
-- -------------------------------------------------------------------------------------------
create or replace function public.block_banned_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Nested writes (foreign-key cascades, other triggers) follow from a write that was already checked.
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if public.is_banned(auth.uid()) then
    raise exception 'Your account is banned.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- The soundboard insert policy counted its own table in a subquery, which Postgres reports as
-- policy recursion once a second policy covers that table. Count through a function instead.
create or replace function public.soundboard_count(p_server uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.soundboard_sounds where server_id = p_server
$$;
revoke all on function public.soundboard_count(uuid) from public, anon;
grant execute on function public.soundboard_count(uuid) to authenticated;
drop policy if exists soundboard_insert on public.soundboard_sounds;
create policy soundboard_insert on public.soundboard_sounds for insert to authenticated
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS'))
              and public.soundboard_count(server_id) < 48);

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and c.relname not in ('user_bans', 'ban_appeals', 'user_warnings', 'user_standing', 'admin_audit')
  loop
    execute format('drop policy if exists not_banned on public.%I', t.relname);
    execute format('create policy not_banned on public.%I as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()))', t.relname);
    execute format('drop trigger if exists zz_block_banned on public.%I', t.relname);
    execute format('create trigger zz_block_banned before insert or update on public.%I for each row execute function public.block_banned_writes()', t.relname);
  end loop;
end;
$$;

drop policy if exists not_banned on storage.objects;
create policy not_banned on storage.objects as restrictive for insert to authenticated with check ((select not public.is_banned()));
drop policy if exists not_banned on realtime.messages;
create policy not_banned on realtime.messages as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));

-- -------------------------------------------------------------------------------------------
-- 4. What a signed-in user sees about themselves (works while banned)
-- -------------------------------------------------------------------------------------------
create or replace function public.my_moderation()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ban public.user_bans; v_appeal public.ban_appeals;
begin
  if auth.uid() is null then return null; end if;
  select * into v_ban from public.user_bans b
   where b.user_id = auth.uid() and b.lifted_at is null and (b.expires_at is null or b.expires_at > now())
   order by b.expires_at desc nulls first limit 1;
  if v_ban.id is not null then
    select * into v_appeal from public.ban_appeals a where a.ban_id = v_ban.id order by a.created_at desc limit 1;
  end if;
  return jsonb_build_object(
    'ban', case when v_ban.id is null then null else jsonb_build_object('id', v_ban.id, 'reason', v_ban.reason, 'created_at', v_ban.created_at, 'expires_at', v_ban.expires_at) end,
    'appeal', case when v_appeal.id is null then null else jsonb_build_object('status', v_appeal.status, 'response', v_appeal.response, 'created_at', v_appeal.created_at) end,
    'level', public.danger_level(auth.uid()),
    'points', public.warning_points(auth.uid()),
    'unacknowledged', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'category', w.category, 'details', w.details, 'severity', w.severity, 'created_at', w.created_at, 'expires_at', w.expires_at) order by w.created_at), '[]'::jsonb)
                         from public.user_warnings w where w.user_id = auth.uid() and w.acknowledged_at is null and w.revoked_at is null)
  );
end;
$$;

create or replace function public.my_warnings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'category', w.category, 'details', w.details, 'severity', w.severity, 'created_at', w.created_at,
           'expires_at', w.expires_at, 'active', w.revoked_at is null and (w.expires_at is null or w.expires_at > now()))
         order by w.created_at desc), '[]'::jsonb)
    from public.user_warnings w where w.user_id = auth.uid() and w.revoked_at is null
$$;

create or replace function public.acknowledge_warnings()
returns void language sql security definer set search_path = '' as $$
  update public.user_warnings set acknowledged_at = now() where user_id = auth.uid() and acknowledged_at is null
$$;

create or replace function public.submit_ban_appeal(p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ban uuid;
begin
  select b.id into v_ban from public.user_bans b
   where b.user_id = auth.uid() and b.lifted_at is null and (b.expires_at is null or b.expires_at > now())
   order by b.expires_at desc nulls first limit 1;
  if v_ban is null then raise exception 'Your account isn''t banned.' using errcode = '22023'; end if;
  if exists (select 1 from public.ban_appeals a where a.ban_id = v_ban and a.status = 'denied'
               and a.reviewed_at > now() - interval '7 days') then
    raise exception 'Your last appeal was denied. You can appeal again 7 days after that decision.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ban_appeals a where a.ban_id = v_ban and a.status = 'open') then
    raise exception 'You already have an appeal waiting for review.' using errcode = '22023';
  end if;
  insert into public.ban_appeals (ban_id, user_id, message) values (v_ban, auth.uid(), btrim(p_message));
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 5. Admin: bans and appeals
-- -------------------------------------------------------------------------------------------
create or replace function public.admin_ban_user(p_user_id uuid, p_reason text, p_duration_hours integer default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require_target(p_user_id);
  if p_duration_hours is not null and p_duration_hours < 1 then raise exception 'Pick a duration of at least an hour.' using errcode = '22023'; end if;
  -- One active ban at a time: a new ban replaces the old one.
  update public.user_bans set lifted_at = now(), lifted_by = auth.uid(), lift_reason = 'Replaced by a new ban'
   where user_id = p_user_id and lifted_at is null and (expires_at is null or expires_at > now());
  insert into public.user_bans (user_id, reason, issued_by, expires_at)
  values (p_user_id, btrim(p_reason), auth.uid(), case when p_duration_hours is null then null else now() + make_interval(hours => p_duration_hours) end);
  -- Drop them out of any voice channel right away.
  delete from public.voice_states where user_id = p_user_id;
  perform public.admin_log('ban', p_user_id, jsonb_build_object('reason', p_reason, 'hours', p_duration_hours));
end;
$$;

create or replace function public.admin_unban_user(p_user_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require_target(p_user_id, true);
  update public.user_bans set lifted_at = now(), lifted_by = auth.uid(), lift_reason = coalesce(nullif(btrim(p_reason), ''), 'Pardoned')
   where user_id = p_user_id and lifted_at is null and (expires_at is null or expires_at > now());
  update public.ban_appeals set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now(), response = coalesce(response, 'Your ban was lifted.')
   where user_id = p_user_id and status = 'open';
  perform public.admin_log('unban', p_user_id, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.admin_list_appeals(p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', a.id, 'user_id', a.user_id, 'username', u.username::text, 'display_name', u.display_name, 'avatar_url', u.avatar_url,
            'message', a.message, 'status', a.status, 'response', a.response, 'created_at', a.created_at, 'reviewed_at', a.reviewed_at,
            'ban', jsonb_build_object('reason', b.reason, 'created_at', b.created_at, 'expires_at', b.expires_at, 'lifted_at', b.lifted_at))
          order by a.created_at desc), '[]'::jsonb)
            from public.ban_appeals a join public.users u on u.id = a.user_id join public.user_bans b on b.id = a.ban_id
           where p_status = 'all' or a.status = p_status);
end;
$$;

create or replace function public.admin_review_appeal(p_appeal_id uuid, p_accept boolean, p_response text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.ban_appeals;
begin
  perform public.admin_require();
  select * into v from public.ban_appeals where id = p_appeal_id;
  if v.id is null then raise exception 'Appeal not found.' using errcode = 'P0002'; end if;
  if v.status <> 'open' then raise exception 'This appeal was already reviewed.' using errcode = '22023'; end if;
  update public.ban_appeals set status = case when p_accept then 'accepted' else 'denied' end,
         response = nullif(btrim(coalesce(p_response, '')), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_appeal_id;
  if p_accept then
    update public.user_bans set lifted_at = now(), lifted_by = auth.uid(), lift_reason = 'Appeal accepted'
     where id = v.ban_id and lifted_at is null;
  end if;
  perform public.admin_log(case when p_accept then 'appeal_accepted' else 'appeal_denied' end, v.user_id, jsonb_build_object('response', p_response));
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 6. Admin: warnings and standing
-- -------------------------------------------------------------------------------------------
create or replace function public.admin_warn_user(p_user_id uuid, p_category text, p_details text, p_severity integer, p_expires_days integer default 90)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.admin_require_target(p_user_id);
  insert into public.user_warnings (user_id, category, details, severity, issued_by, expires_at)
  values (p_user_id, p_category, nullif(btrim(coalesce(p_details, '')), ''), p_severity, auth.uid(),
          case when p_expires_days is null then null else now() + make_interval(days => p_expires_days) end)
  returning id into v_id;
  perform public.admin_log('warn', p_user_id, jsonb_build_object('category', p_category, 'severity', p_severity, 'details', p_details));
  return v_id;
end;
$$;

create or replace function public.admin_update_warning(p_warning_id uuid, p_category text, p_details text, p_severity integer, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform public.admin_require();
  update public.user_warnings set category = p_category, details = nullif(btrim(coalesce(p_details, '')), ''), severity = p_severity, expires_at = p_expires_at
   where id = p_warning_id returning user_id into v_user;
  if v_user is null then raise exception 'Warning not found.' using errcode = 'P0002'; end if;
  perform public.admin_log('warning_edited', v_user, jsonb_build_object('warning', p_warning_id, 'severity', p_severity));
end;
$$;

-- p_mode: 'revoke' (keeps it in history), 'restore', or 'delete' (gone for good)
create or replace function public.admin_set_warning_state(p_warning_id uuid, p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform public.admin_require();
  select user_id into v_user from public.user_warnings where id = p_warning_id;
  if v_user is null then raise exception 'Warning not found.' using errcode = 'P0002'; end if;
  if p_mode = 'revoke' then
    update public.user_warnings set revoked_at = now(), revoked_by = auth.uid() where id = p_warning_id;
  elsif p_mode = 'restore' then
    update public.user_warnings set revoked_at = null, revoked_by = null where id = p_warning_id;
  elsif p_mode = 'delete' then
    delete from public.user_warnings where id = p_warning_id;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform public.admin_log('warning_' || p_mode, v_user, jsonb_build_object('warning', p_warning_id));
end;
$$;

create or replace function public.admin_set_standing(p_user_id uuid, p_override text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require_target(p_user_id, true);
  insert into public.user_standing (user_id, override, note, updated_by, updated_at)
  values (p_user_id, p_override, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (user_id) do update set override = excluded.override, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  perform public.admin_log('standing', p_user_id, jsonb_build_object('override', p_override));
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 7. Admin: user details, profile edits, deletion, audit
-- -------------------------------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  return (
    select jsonb_build_object(
      'id', u.id, 'username', u.username::text, 'display_name', u.display_name, 'bio', u.bio, 'avatar_url', u.avatar_url,
      'banner_url', u.banner_url, 'is_admin', u.is_admin, 'badge_ids', u.badge_ids, 'created_at', u.created_at,
      'email', a.email, 'email_confirmed_at', a.email_confirmed_at, 'last_sign_in_at', a.last_sign_in_at,
      'servers_owned', (select count(*) from public.servers s where s.owner_id = u.id),
      'servers', (select count(*) from public.server_members m where m.user_id = u.id),
      'messages', (select count(*) from public.messages m where m.author_id = u.id),
      'reports_against', (select count(*) from public.reports r where r.target_user_id = u.id),
      'banned', public.is_banned(u.id),
      'level', public.danger_level(u.id),
      'computed_level', (select case when p = 0 then 'good' when p <= 2 then 'low' when p <= 4 then 'medium' when p <= 7 then 'high' else 'critical' end
                           from (select public.warning_points(u.id) as p) x),
      'points', public.warning_points(u.id),
      'standing', (select jsonb_build_object('override', s.override, 'note', s.note, 'updated_at', s.updated_at) from public.user_standing s where s.user_id = u.id),
      'bans', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', b.id, 'reason', b.reason, 'created_at', b.created_at, 'expires_at', b.expires_at, 'lifted_at', b.lifted_at,
                  'lift_reason', b.lift_reason, 'by', (select x.username::text from public.users x where x.id = b.issued_by),
                  'active', b.lifted_at is null and (b.expires_at is null or b.expires_at > now()))
                order by b.created_at desc), '[]'::jsonb) from public.user_bans b where b.user_id = u.id),
      'warnings', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', w.id, 'category', w.category, 'details', w.details, 'severity', w.severity, 'created_at', w.created_at,
                  'expires_at', w.expires_at, 'revoked_at', w.revoked_at, 'acknowledged_at', w.acknowledged_at,
                  'by', (select x.username::text from public.users x where x.id = w.issued_by),
                  'active', w.revoked_at is null and (w.expires_at is null or w.expires_at > now()))
                order by w.created_at desc), '[]'::jsonb) from public.user_warnings w where w.user_id = u.id),
      'appeals', (select coalesce(jsonb_agg(jsonb_build_object('id', ap.id, 'message', ap.message, 'status', ap.status, 'response', ap.response, 'created_at', ap.created_at)
                order by ap.created_at desc), '[]'::jsonb) from public.ban_appeals ap where ap.user_id = u.id),
      'audit', (select coalesce(jsonb_agg(x order by (x ->> 'created_at') desc), '[]'::jsonb) from (
                  select jsonb_build_object('action', l.action, 'details', l.details, 'created_at', l.created_at,
                         'by', (select y.username::text from public.users y where y.id = l.actor_id)) as x
                    from public.admin_audit l where l.target_id = u.id order by l.created_at desc limit 30) q)
    )
    from public.users u join auth.users a on a.id = u.id where u.id = p_user_id
  );
end;
$$;

create or replace function public.admin_update_profile(p_user_id uuid, p_username text, p_display_name text, p_bio text,
                                                      p_clear_avatar boolean default false, p_clear_banner boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require_target(p_user_id, true);
  if exists (select 1 from public.users where lower(username::text) = lower(btrim(p_username)) and id <> p_user_id) then
    raise exception 'That username is taken.' using errcode = '23505';
  end if;
  update public.users set
    username     = btrim(p_username),
    display_name = nullif(btrim(coalesce(p_display_name, '')), ''),
    bio          = nullif(p_bio, ''),
    avatar_url   = case when p_clear_avatar then null else avatar_url end,
    banner_url   = case when p_clear_banner then null else banner_url end,
    updated_at   = now()
  where id = p_user_id;
  perform public.admin_log('profile_edited', p_user_id, jsonb_build_object('username', p_username, 'display_name', p_display_name,
                           'cleared_avatar', p_clear_avatar, 'cleared_banner', p_clear_banner));
end;
$$;

create or replace function public.admin_delete_user(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require_target(p_user_id);
  perform public.admin_log('delete', p_user_id, jsonb_build_object('reason', p_reason,
           'servers_deleted', (select coalesce(jsonb_agg(s.name), '[]'::jsonb) from public.servers s where s.owner_id = p_user_id)));
  -- Their messages stay, shown as "Deleted user"; servers they own are deleted with them.
  delete from auth.users where id = p_user_id;
end;
$$;

-- Signs an account out on every device (their access token still works until it expires, ≤ 1 h).
create or replace function public.admin_sign_out_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require_target(p_user_id);
  delete from auth.sessions where user_id = p_user_id;
  perform public.admin_log('signed_out', p_user_id);
end;
$$;

create or replace function public.admin_audit_list(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('id', l.id, 'action', l.action, 'target_id', l.target_id, 'target_name', l.target_name, 'details', l.details,
                              'created_at', l.created_at, 'by', (select u.username::text from public.users u where u.id = l.actor_id)) as x
      from public.admin_audit l order by l.created_at desc limit least(greatest(p_limit, 1), 500)) q);
end;
$$;

-- Search now also reports bans and standing.
drop function if exists public.admin_search_users(text);
create or replace function public.admin_search_users(p_query text)
returns table (id uuid, username text, display_name text, avatar_url text, email text, is_admin boolean, badge_ids jsonb,
               created_at timestamptz, last_sign_in_at timestamptz, servers integer, messages integer, banned boolean, level text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  return query
    select u.id, u.username::text, u.display_name, u.avatar_url, a.email::text, u.is_admin, u.badge_ids, u.created_at, a.last_sign_in_at,
           (select count(*)::integer from public.server_members m where m.user_id = u.id),
           (select count(*)::integer from public.messages m where m.author_id = u.id),
           public.is_banned(u.id), public.danger_level(u.id)
      from public.users u join auth.users a on a.id = u.id
     where btrim(coalesce(p_query, '')) = ''
        or u.username::text ilike '%' || btrim(p_query) || '%'
        or u.display_name ilike '%' || btrim(p_query) || '%'
        or a.email ilike '%' || btrim(p_query) || '%'
        or u.id::text = btrim(p_query)
        or (btrim(p_query) = 'is:banned' and public.is_banned(u.id))
        or (btrim(p_query) = 'is:warned' and public.warning_points(u.id) > 0)
        or (btrim(p_query) = 'is:admin' and u.is_admin)
     order by u.created_at desc
     limit 50;
end;
$$;

-- Existing admin actions now land in the audit log too.
create or replace function public.admin_set_admin(p_user_id uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  if p_user_id = auth.uid() and not p_admin then
    raise exception 'You can''t remove your own admin access.' using errcode = '22023';
  end if;
  update public.users set is_admin = p_admin where id = p_user_id;
  perform public.admin_log(case when p_admin then 'admin_granted' else 'admin_removed' end, p_user_id);
end;
$$;

create or replace function public.admin_set_badges(p_user_id uuid, p_badges jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  update public.users set badge_ids = p_badges where id = p_user_id;
  perform public.admin_log('badges', p_user_id, jsonb_build_object('badges', p_badges));
end;
$$;

-- Stats gain moderation counts.
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  return jsonb_build_object(
    'users', (select count(*) from public.users),
    'users_7d', (select count(*) from public.users where created_at > now() - interval '7 days'),
    'servers', (select count(*) from public.servers),
    'messages', (select count(*) from public.messages),
    'messages_24h', (select count(*) from public.messages where created_at > now() - interval '24 hours'),
    'voice_now', (select count(*) from public.voice_states where updated_at > now() - interval '90 seconds'),
    'open_reports', (select count(*) from public.reports where status = 'open' and server_id is null),
    'admins', (select count(*) from public.users where is_admin),
    'banned', (select count(distinct b.user_id) from public.user_bans b where b.lifted_at is null and (b.expires_at is null or b.expires_at > now())),
    'open_appeals', (select count(*) from public.ban_appeals where status = 'open'),
    'active_warnings', (select count(*) from public.user_warnings w where w.revoked_at is null and (w.expires_at is null or w.expires_at > now()))
  );
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 8. Privileges
-- -------------------------------------------------------------------------------------------
revoke all on function public.is_banned(uuid), public.warning_points(uuid), public.danger_level(uuid), public.admin_log(text, uuid, jsonb),
                       public.admin_require_target(uuid, boolean), public.block_banned_writes(), public.my_moderation(), public.my_warnings(),
                       public.acknowledge_warnings(), public.submit_ban_appeal(text), public.admin_ban_user(uuid, text, integer),
                       public.admin_unban_user(uuid, text), public.admin_list_appeals(text), public.admin_review_appeal(uuid, boolean, text),
                       public.admin_warn_user(uuid, text, text, integer, integer), public.admin_update_warning(uuid, text, text, integer, timestamptz),
                       public.admin_set_warning_state(uuid, text), public.admin_set_standing(uuid, text, text), public.admin_user_detail(uuid),
                       public.admin_update_profile(uuid, text, text, text, boolean, boolean), public.admin_delete_user(uuid, text),
                       public.admin_audit_list(integer), public.admin_search_users(text), public.admin_stats(), public.admin_sign_out_user(uuid)
  from public, anon;
grant execute on function public.is_banned(uuid), public.my_moderation(), public.my_warnings(), public.acknowledge_warnings(), public.submit_ban_appeal(text),
                          public.admin_ban_user(uuid, text, integer), public.admin_unban_user(uuid, text), public.admin_list_appeals(text),
                          public.admin_review_appeal(uuid, boolean, text), public.admin_warn_user(uuid, text, text, integer, integer),
                          public.admin_update_warning(uuid, text, text, integer, timestamptz), public.admin_set_warning_state(uuid, text),
                          public.admin_set_standing(uuid, text, text), public.admin_user_detail(uuid),
                          public.admin_update_profile(uuid, text, text, text, boolean, boolean), public.admin_delete_user(uuid, text),
                          public.admin_audit_list(integer), public.admin_search_users(text), public.admin_stats(), public.admin_sign_out_user(uuid)
  to authenticated;
