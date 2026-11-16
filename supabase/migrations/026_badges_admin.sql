-- Aether 1.9.3: custom badges and a bigger admin panel. Run after 025.
--   * badges: admins make their own badges (an icon from Aether's set, or an uploaded image), with a
--     name, description and color. The built-in badges people already have move in here; the five
--     nobody had (Moderator, Voice Veteran, velox Native, Supporter, Artist) are gone.
--   * Admin tools for servers: list and search every server, hide one from Discover, delete one.
--   * Activity over time for the Overview: sign-ups, messages and active people per day.

create table if not exists public.badges (
  id          text primary key check (id ~ '^[a-z0-9-]{2,32}$'),
  label       text not null check (char_length(btrim(label)) between 1 and 40),
  description text check (char_length(description) <= 120),
  color       text not null default '#7c5cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon        text check (icon is null or icon ~ '^[a-z0-9-]{1,40}$'),
  icon_url    text check (icon_url is null or (char_length(icon_url) <= 500 and icon_url ~ '^https://')),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  check (icon is not null or icon_url is not null)
);
alter table public.badges enable row level security;
drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges for select to anon, authenticated using (true);
grant select on public.badges to anon, authenticated;
drop policy if exists mfa_required on public.badges;
create policy mfa_required on public.badges as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

insert into public.badges (id, label, description, color, icon, position) values
  ('founder', 'Founder', 'Started Aether', '#f5c542', 'crown', 0),
  ('staff', 'Aether Staff', 'Works on Aether', '#7c5cff', 'shield', 1),
  ('developer', 'Developer', 'Builds Aether', '#00d4ff', 'code', 2),
  ('early-supporter', 'Early Supporter', 'Here from the start', '#ff7ab6', 'heart', 3),
  ('tester', 'Beta Tester', 'Tried new versions before everyone else', '#7bd88f', 'flask', 4),
  ('bug-hunter', 'Bug Hunter', 'Found and reported bugs', '#ff9f43', 'bug', 5),
  ('pioneer', 'Pioneer', null, '#5ab0ff', 'rocket', 6),
  ('champion', 'Champion', null, '#ffd166', 'trophy', 7)
on conflict (id) do nothing;

-- Badge images: admins upload, everyone can see.
insert into storage.buckets (id, name, public, file_size_limit)
values ('badges', 'badges', true, 262144)
on conflict (id) do nothing;
drop policy if exists "storage: badge images by admins" on storage.objects;
create policy "storage: badge images by admins" on storage.objects for insert to authenticated
  with check (bucket_id = 'badges' and public.is_app_admin());
drop policy if exists "storage: badge images removed by admins" on storage.objects;
create policy "storage: badge images removed by admins" on storage.objects for delete to authenticated
  using (bucket_id = 'badges' and public.is_app_admin());

create or replace function public.admin_save_badge(p_id text, p_label text, p_description text, p_color text, p_icon text, p_icon_url text, p_position integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_new boolean;
begin
  perform public.admin_require();
  v_new := not exists (select 1 from public.badges where id = p_id);
  insert into public.badges (id, label, description, color, icon, icon_url, position)
  values (p_id, btrim(p_label), nullif(btrim(coalesce(p_description, '')), ''), p_color, nullif(p_icon, ''), nullif(p_icon_url, ''),
          coalesce(p_position, (select coalesce(max(position), -1) + 1 from public.badges)))
  on conflict (id) do update set label = excluded.label, description = excluded.description, color = excluded.color,
                                 icon = excluded.icon, icon_url = excluded.icon_url, position = coalesce(p_position, public.badges.position);
  perform public.admin_log(case when v_new then 'badge_create' else 'badge_update' end, null, jsonb_build_object('badge', p_id, 'label', p_label));
end;
$$;

-- Deleting a badge also takes it off everyone who had it.
create or replace function public.admin_delete_badge(p_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform public.admin_require();
  update public.users set badge_ids = badge_ids - p_id where badge_ids ? p_id;
  get diagnostics v_n = row_count;
  delete from public.badges where id = p_id;
  perform public.admin_log('badge_delete', null, jsonb_build_object('badge', p_id, 'holders', v_n));
  return v_n;
end;
$$;

create or replace function public.admin_badge_holders(p_id text)
returns table (id uuid, username text, display_name text, avatar_url text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  return query select u.id, u.username::text, u.display_name, u.avatar_url from public.users u where u.badge_ids ? p_id order by u.username limit 500;
end;
$$;

-- Give one badge to (or take it from) someone, without touching their other badges.
create or replace function public.admin_toggle_badge(p_user_id uuid, p_id text, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  if p_on and not exists (select 1 from public.badges where id = p_id) then raise exception 'No such badge.' using errcode = '22023'; end if;
  update public.users set badge_ids = case when p_on then (case when badge_ids ? p_id then badge_ids else badge_ids || to_jsonb(p_id) end) else badge_ids - p_id end
   where id = p_user_id;
  perform public.admin_log(case when p_on then 'badge_give' else 'badge_take' end, p_user_id, jsonb_build_object('badge', p_id));
end;
$$;

-- ── Servers ───────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_list_servers(p_query text default '', p_limit integer default 100)
returns table (id uuid, name text, icon_url text, owner_id uuid, owner_username text, members integer, messages_7d integer, discoverable boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  return query
    select s.id, s.name::text, s.icon_url, s.owner_id, o.username::text,
           (select count(*)::int from public.server_members m where m.server_id = s.id),
           (select count(*)::int from public.messages msg join public.channels c on c.id = msg.channel_id
             where c.server_id = s.id and msg.created_at > now() - interval '7 days'),
           coalesce(s.discoverable, false), s.created_at
      from public.servers s left join public.users o on o.id = s.owner_id
     where coalesce(p_query, '') = '' or s.name ilike '%' || p_query || '%' or o.username::text ilike '%' || p_query || '%' or s.id::text = p_query
     order by (select count(*) from public.server_members m where m.server_id = s.id) desc, s.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create or replace function public.admin_set_server_discoverable(p_server_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  update public.servers set discoverable = p_on where id = p_server_id;
  perform public.admin_log(case when p_on then 'server_discover_on' else 'server_discover_off' end, null,
                           jsonb_build_object('server_id', p_server_id, 'server', (select name from public.servers where id = p_server_id)));
end;
$$;

create or replace function public.admin_delete_server(p_server_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text; v_owner uuid;
begin
  perform public.admin_require();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason.' using errcode = '22023'; end if;
  select name, owner_id into v_name, v_owner from public.servers where id = p_server_id;
  if v_name is null then raise exception 'That server doesn''t exist.' using errcode = '22023'; end if;
  perform public.admin_log('server_delete', v_owner, jsonb_build_object('server_id', p_server_id, 'server', v_name, 'reason', left(p_reason, 500)));
  delete from public.servers where id = p_server_id;
end;
$$;

-- ── Activity over time ──────────────────────────────────────────────────────────────────────
create or replace function public.admin_activity(p_days integer default 30)
returns table (day date, signups integer, messages integer, active_users integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_days integer := least(greatest(coalesce(p_days, 30), 7), 90);
begin
  perform public.admin_require();
  return query
    with days as (select generate_series((now() - make_interval(days => v_days - 1))::date, now()::date, interval '1 day')::date d),
    msgs as (
      select m.created_at::date d, count(*)::int n, count(distinct m.author_id)::int a
        from public.messages m where m.created_at >= (now() - make_interval(days => v_days))::date group by 1
    ),
    sign as (select u.created_at::date d, count(*)::int n from public.users u where u.created_at >= (now() - make_interval(days => v_days))::date group by 1)
    select days.d, coalesce(sign.n, 0), coalesce(msgs.n, 0), coalesce(msgs.a, 0)
      from days left join msgs on msgs.d = days.d left join sign on sign.d = days.d
     order by days.d;
end;
$$;

revoke all on function public.admin_save_badge(text, text, text, text, text, text, integer), public.admin_delete_badge(text), public.admin_badge_holders(text),
                       public.admin_toggle_badge(uuid, text, boolean), public.admin_list_servers(text, integer), public.admin_set_server_discoverable(uuid, boolean),
                       public.admin_delete_server(uuid, text), public.admin_activity(integer) from public, anon;
grant execute on function public.admin_save_badge(text, text, text, text, text, text, integer), public.admin_delete_badge(text), public.admin_badge_holders(text),
                          public.admin_toggle_badge(uuid, text, boolean), public.admin_list_servers(text, integer), public.admin_set_server_discoverable(uuid, boolean),
                          public.admin_delete_server(uuid, text), public.admin_activity(integer) to authenticated;
