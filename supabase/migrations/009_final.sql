-- aether.chat 1.0: final batch
--   * platform admins (users.is_admin) and app-wide settings (app_config), with admin-only RPCs
--   * nameplates, profile frames and profile widgets
--   * people search ("Search for someone") with an opt-out, and DMs to anyone you find, which
--     arrive as message requests limited to N messages (app_config.message_request_limit, default 3)
--   * admins can review reports that aren't tied to a server (DMs, user reports)
-- Run after 008_privacy_safety.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Admins and app config
-- -------------------------------------------------------------------------------------------
alter table public.users add column if not exists is_admin boolean not null default false;
-- is_admin is deliberately not in the column UPDATE grant: only admins (via RPC) or the service role change it.

create or replace function public.is_app_admin(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_admin from public.users u where u.id = p_user), false)
$$;

create table if not exists public.app_config (
  key        text primary key check (key ~ '^[a-z0-9_]{1,48}$'),
  value      jsonb not null,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to authenticated using (true);
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to authenticated;

insert into public.app_config (key, value) values
  ('message_request_limit', '3'::jsonb),
  ('people_search_enabled', 'true'::jsonb),
  ('announcement', 'null'::jsonb)
on conflict (key) do nothing;

create or replace function public.app_setting(p_key text, p_default jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select c.value from public.app_config c where c.key = p_key), p_default)
$$;

-- -------------------------------------------------------------------------------------------
-- 2. Profile customization: nameplates, frames, widgets, discoverability
-- -------------------------------------------------------------------------------------------
create or replace function public.is_valid_widgets(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 6 and octet_length(p::text) <= 8000
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e ->> 'type', '') not in ('favorite_game', 'games', 'about', 'music', 'quote')
     )
$$;

alter table public.users
  add column if not exists nameplate      text not null default 'none' check (nameplate ~ '^[a-z0-9-]{1,32}$'),
  add column if not exists card_frame     text not null default 'none' check (card_frame ~ '^[a-z0-9-]{1,32}$'),
  add column if not exists profile_widgets jsonb not null default '[]'::jsonb check (public.is_valid_widgets(profile_widgets)),
  add column if not exists discoverable   boolean not null default true;

-- Effects and styles are now open-ended ids (the app ships more over time).
alter table public.users drop constraint if exists users_profile_effect_check;
alter table public.users add constraint users_profile_effect_check check (profile_effect ~ '^[a-z0-9-]{1,32}$');
alter table public.users drop constraint if exists users_card_style_check;
alter table public.users add constraint users_card_style_check check (card_style ~ '^[a-z0-9-]{1,32}$');
alter table public.users drop constraint if exists users_name_effect_check;
alter table public.users add constraint users_name_effect_check check (name_effect ~ '^[a-z0-9-]{1,32}$');
alter table public.users drop constraint if exists users_name_font_check;
alter table public.users add constraint users_name_font_check check (name_font ~ '^[a-z0-9-]{1,32}$');

grant update (nameplate, card_frame, profile_widgets, discoverable) on public.users to authenticated;

-- -------------------------------------------------------------------------------------------
-- 3. People search and DMs to anyone (as limited message requests)
-- -------------------------------------------------------------------------------------------
alter table public.privacy_settings drop constraint if exists privacy_settings_dm_policy_check;
alter table public.privacy_settings add constraint privacy_settings_dm_policy_check check (dm_policy in ('everyone', 'servers', 'friends'));
alter table public.privacy_settings alter column dm_policy set default 'everyone';
grant delete on public.privacy_settings to authenticated;

create or replace function public.privacy_of(p_user uuid)
returns public.privacy_settings language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p from public.privacy_settings p where p.user_id = p_user),
    row(p_user, 'everyone', 'everyone', true, now())::public.privacy_settings
  )
$$;

create or replace function public.search_users(p_query text, p_limit integer default 20)
returns table (id uuid, username text, display_name text, avatar_url text, avatar_frame text, accent_color text, is_friend boolean, mutual_servers integer)
language sql stable security definer set search_path = '' as $$
  select u.id, u.username::text, u.display_name, u.avatar_url, u.avatar_frame, u.accent_color,
         public.are_friends(auth.uid(), u.id),
         (select count(*)::integer from public.server_members a join public.server_members b on b.server_id = a.server_id
           where a.user_id = auth.uid() and b.user_id = u.id)
    from public.users u
   where auth.uid() is not null
     and (public.app_setting('people_search_enabled', 'true'::jsonb))::text = 'true'
     and char_length(btrim(coalesce(p_query, ''))) >= 2
     and u.id <> auth.uid()
     and u.discoverable
     and not public.is_blocked_between(auth.uid(), u.id)
     and (u.username::text ilike '%' || btrim(p_query) || '%' or u.display_name ilike '%' || btrim(p_query) || '%')
   order by (lower(u.username::text) = lower(btrim(p_query))) desc,
            (lower(u.username::text) like lower(btrim(p_query)) || '%') desc,
            u.username
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

create or replace function public.open_dm(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := auth.uid();
  v_key     text;
  v_conv    uuid;
  v_friends boolean;
  v_shared  boolean;
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
    v_shared := public.shares_server(v_me, p_user_id);
    v_privacy := public.privacy_of(p_user_id);
    if not v_friends and v_privacy.dm_policy = 'friends' then
      raise exception 'This user only accepts direct messages from friends.' using errcode = '42501';
    end if;
    if not v_friends and not v_shared and v_privacy.dm_policy <> 'everyone' then
      raise exception 'This user only accepts messages from friends and people in their servers.' using errcode = '42501';
    end if;
    insert into public.conversations (type, dm_key) values ('dm', v_key)
      on conflict (dm_key) do nothing
      returning id into v_conv;
    if v_conv is null then
      select id into v_conv from public.conversations where dm_key = v_key;
    else
      insert into public.conversation_members (conversation_id, user_id, request_pending)
      values (v_conv, v_me, false),
             -- strangers (no shared server) always land in requests; server-mates follow the setting
             (v_conv, p_user_id, not v_friends and (not v_shared or v_privacy.message_requests));
    end if;
  end if;

  update public.conversation_members set hidden = false where conversation_id = v_conv and user_id = v_me;
  return v_conv;
end;
$$;

-- Sending to someone who hasn't accepted your request yet is capped.
create or replace function public.limit_request_messages()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_sent  integer;
begin
  if new.conversation_id is null then return new; end if;
  if not exists (
    select 1 from public.conversation_members cm
     where cm.conversation_id = new.conversation_id and cm.user_id <> new.author_id and cm.request_pending
  ) then
    return new;
  end if;
  v_limit := coalesce((public.app_setting('message_request_limit', '3'::jsonb))::text::integer, 3);
  select count(*) into v_sent from public.messages m where m.conversation_id = new.conversation_id and m.author_id = new.author_id;
  if v_sent >= v_limit then
    raise exception 'They haven''t accepted your message request yet. You can send up to % messages until they do.', v_limit using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_zy_request_limit on public.messages;
create trigger messages_zy_request_limit before insert on public.messages
  for each row execute function public.limit_request_messages();

-- -------------------------------------------------------------------------------------------
-- 4. Reports outside servers are reviewed by admins
-- -------------------------------------------------------------------------------------------
drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated
  using (reporter_id = (select auth.uid())
         or (server_id is not null and public.has_server_permission(server_id, public.permission_bit('MANAGE_MESSAGES')))
         or public.is_app_admin());

create or replace function public.resolve_report(p_report_id uuid, p_status text, p_resolution text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rep public.reports;
begin
  select * into v_rep from public.reports where id = p_report_id;
  if v_rep.id is null or not (
       public.is_app_admin()
       or (v_rep.server_id is not null and public.has_server_permission(v_rep.server_id, public.permission_bit('MANAGE_MESSAGES')))
     ) then
    raise exception 'You can''t review this report.' using errcode = '42501';
  end if;
  if p_status not in ('open', 'resolved', 'dismissed') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  update public.reports
     set status = p_status, resolution = left(p_resolution, 300),
         resolved_by = case when p_status = 'open' then null else auth.uid() end,
         resolved_at = case when p_status = 'open' then null else now() end
   where id = p_report_id;
  if v_rep.server_id is not null then
    perform public.write_audit(v_rep.server_id, 'report_' || p_status, 'member', v_rep.target_user_id, null, '{}'::jsonb, p_resolution);
  end if;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 5. Admin RPCs (every one checks is_app_admin)
-- -------------------------------------------------------------------------------------------
create or replace function public.admin_require()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
end;
$$;

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
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'admins', (select count(*) from public.users where is_admin)
  );
end;
$$;

create or replace function public.admin_search_users(p_query text)
returns table (id uuid, username text, display_name text, avatar_url text, email text, is_admin boolean, badge_ids jsonb,
               created_at timestamptz, last_sign_in_at timestamptz, servers integer, messages integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  return query
    select u.id, u.username::text, u.display_name, u.avatar_url, a.email::text, u.is_admin, u.badge_ids, u.created_at, a.last_sign_in_at,
           (select count(*)::integer from public.server_members m where m.user_id = u.id),
           (select count(*)::integer from public.messages m where m.author_id = u.id)
      from public.users u join auth.users a on a.id = u.id
     where btrim(coalesce(p_query, '')) = ''
        or u.username::text ilike '%' || btrim(p_query) || '%'
        or u.display_name ilike '%' || btrim(p_query) || '%'
        or a.email ilike '%' || btrim(p_query) || '%'
        or u.id::text = btrim(p_query)
     order by u.created_at desc
     limit 50;
end;
$$;

create or replace function public.admin_set_admin(p_user_id uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  if p_user_id = auth.uid() and not p_admin then
    raise exception 'You can''t remove your own admin access.' using errcode = '22023';
  end if;
  update public.users set is_admin = p_admin where id = p_user_id;
end;
$$;

create or replace function public.admin_set_badges(p_user_id uuid, p_badges jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  update public.users set badge_ids = p_badges where id = p_user_id;
end;
$$;

create or replace function public.admin_set_config(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  insert into public.app_config (key, value, updated_by, updated_at) values (p_key, p_value, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 6. Privileges
-- -------------------------------------------------------------------------------------------
revoke all on function public.is_app_admin(uuid), public.app_setting(text, jsonb), public.search_users(text, integer),
                       public.limit_request_messages(), public.admin_require(), public.admin_stats(), public.admin_search_users(text),
                       public.admin_set_admin(uuid, boolean), public.admin_set_badges(uuid, jsonb), public.admin_set_config(text, jsonb)
  from public, anon;
grant execute on function public.is_app_admin(uuid), public.search_users(text, integer), public.admin_stats(), public.admin_search_users(text),
                          public.admin_set_admin(uuid, boolean), public.admin_set_badges(uuid, jsonb), public.admin_set_config(text, jsonb)
  to authenticated;
