-- aether.chat 1.4: cosmetics data, push notifications, server discovery, webhooks, custom emoji
-- Run after 012_servers_bot.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Profile decor: custom colours, crops and effect settings; any registered avatar shape
-- -------------------------------------------------------------------------------------------
alter table public.users drop constraint if exists users_avatar_shape_check;
alter table public.users add constraint users_avatar_shape_check check (avatar_shape ~ '^[a-z0-9-]{1,32}$');
alter table public.users add column if not exists decor jsonb not null default '{}'::jsonb
  check (jsonb_typeof(decor) = 'object' and octet_length(decor::text) <= 4000);
grant update (decor) on public.users to authenticated;

-- -------------------------------------------------------------------------------------------
-- 2. Push notifications (Web Push for the web app and browsers)
-- -------------------------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists not_banned on public.push_subscriptions;
create policy not_banned on public.push_subscriptions as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));
grant select, insert, delete on public.push_subscriptions to authenticated;

-- A shared secret so only our database can ask the push function to send.
do $$
begin
  if to_regclass('vault.secrets') is not null and not exists (select 1 from vault.secrets where name = 'push_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'push_secret');
  end if;
exception when others then null;
end;
$$;

create or replace function public.push_secret()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v using 'push_secret';
  return v;
end;
$$;
revoke all on function public.push_secret() from public, anon, authenticated;
grant execute on function public.push_secret() to service_role;

-- New DMs and @mentions wake the push function (it decides who actually gets notified).
create or replace function public.push_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if new.is_bot or current_setting('aether.crosspost', true) = '1' then return null; end if;
  if new.conversation_id is null and coalesce(cardinality(new.mentions), 0) = 0 and coalesce(cardinality(new.mention_roles), 0) = 0 then return null; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return null; end if;
  v_secret := public.push_secret();
  if v_secret is null then return null; end if;
  execute 'select net.http_post($1, $2, ''{}''::jsonb, $3, 5000)'
    using 'https://pyjvnbjsjtbogrmoimwf.supabase.co/functions/v1/push',
          jsonb_build_object('message_id', new.id),
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
  return null;
exception when others then
  return null; -- never let notifications break sending
end;
$$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages for each row execute function public.push_on_message();

-- -------------------------------------------------------------------------------------------
-- 3. Server discovery
-- -------------------------------------------------------------------------------------------
alter table public.servers
  add column if not exists discoverable       boolean not null default false,
  add column if not exists discovery_category text check (discovery_category in ('gaming', 'music', 'art', 'tech', 'education', 'anime', 'social', 'science', 'sports', 'other'));
grant update (discoverable, discovery_category) on public.servers to authenticated;

create or replace function public.discover_servers(p_query text default '', p_category text default null)
returns table (id uuid, name text, description text, icon_url text, banner_url text, category text, member_count integer, is_member boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.description, s.icon_url, s.banner_url, s.discovery_category,
         (select count(*)::integer from public.server_members m where m.server_id = s.id),
         exists (select 1 from public.server_members m where m.server_id = s.id and m.user_id = auth.uid())
    from public.servers s
   where s.discoverable
     and (p_category is null or s.discovery_category = p_category)
     and (btrim(coalesce(p_query, '')) = '' or s.name ilike '%' || btrim(p_query) || '%' or s.description ilike '%' || btrim(p_query) || '%')
   order by (select count(*) from public.server_members m where m.server_id = s.id) desc, s.created_at desc
   limit 60
$$;

create or replace function public.join_discoverable(p_server_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.servers where id = p_server_id and discoverable) then
    raise exception 'That server isn''t open to join. Ask for an invite.' using errcode = '42501';
  end if;
  if exists (select 1 from public.server_bans b where b.server_id = p_server_id and b.user_id = auth.uid()) then
    raise exception 'You''re banned from this server.' using errcode = '42501';
  end if;
  insert into public.server_members (server_id, user_id) values (p_server_id, auth.uid()) on conflict do nothing;
  return p_server_id;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 4. Webhooks (post into a channel from outside, Discord-compatible JSON)
-- -------------------------------------------------------------------------------------------
alter table public.messages
  add column if not exists bot_name   text check (char_length(bot_name) <= 80),
  add column if not exists bot_avatar text check (bot_avatar ~ '^https://');

create table if not exists public.channel_webhooks (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  server_id  uuid not null references public.servers (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  avatar_url text check (avatar_url ~ '^https://'),
  token      text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by uuid default auth.uid() references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  uses_minute integer not null default 0,
  minute_start timestamptz not null default now()
);
create index if not exists channel_webhooks_channel_idx on public.channel_webhooks (channel_id);
alter table public.channel_webhooks enable row level security;
drop policy if exists webhooks_manage on public.channel_webhooks;
create policy webhooks_manage on public.channel_webhooks for all to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_CHANNELS')))
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_CHANNELS'))
              and exists (select 1 from public.channels c where c.id = channel_id and c.server_id = channel_webhooks.server_id and c.type = 'text'));
drop policy if exists not_banned on public.channel_webhooks;
create policy not_banned on public.channel_webhooks as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));
grant select, delete on public.channel_webhooks to authenticated;
grant insert (channel_id, server_id, name, avatar_url) on public.channel_webhooks to authenticated;
grant update (name, avatar_url) on public.channel_webhooks to authenticated;

-- Called by the webhook Edge Function (anyone with the URL). 30 messages a minute per webhook.
create or replace function public.webhook_post(p_id uuid, p_token text, p_content text, p_username text default null, p_avatar text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.channel_webhooks; v_msg uuid;
begin
  select * into v from public.channel_webhooks where id = p_id for update;
  if v.id is null or v.token <> coalesce(p_token, '') then raise exception 'Unknown webhook.' using errcode = '42501'; end if;
  if btrim(coalesce(p_content, '')) = '' then raise exception 'Empty message.' using errcode = '22023'; end if;
  if v.minute_start < now() - interval '1 minute' then
    update public.channel_webhooks set minute_start = now(), uses_minute = 0 where id = v.id;
    v.uses_minute := 0;
  end if;
  if v.uses_minute >= 30 then raise exception 'Slow down: 30 messages a minute per webhook.' using errcode = 'P0001'; end if;
  update public.channel_webhooks set uses_minute = uses_minute + 1, last_used_at = now() where id = v.id;
  perform set_config('aether.crosspost', '1', true);
  insert into public.messages (channel_id, author_id, content, is_bot, bot_command, bot_name, bot_avatar)
  values (v.channel_id, null, left(p_content, 4000), true, 'webhook',
          left(coalesce(nullif(btrim(p_username), ''), v.name), 80),
          case when p_avatar ~ '^https://' then left(p_avatar, 500) else v.avatar_url end)
  returning id into v_msg;
  perform set_config('aether.crosspost', '0', true);
  return v_msg;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- 5. Custom server emoji
-- -------------------------------------------------------------------------------------------
create table if not exists public.server_emojis (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid not null references public.servers (id) on delete cascade,
  name       text not null check (name ~ '^[a-z0-9_]{2,32}$'),
  url        text not null check (url ~ '^https://'),
  animated   boolean not null default false,
  created_by uuid default auth.uid() references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);
alter table public.server_emojis enable row level security;
create or replace function public.server_emoji_count(p_server uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.server_emojis where server_id = p_server
$$;
revoke all on function public.server_emoji_count(uuid) from public, anon;
grant execute on function public.server_emoji_count(uuid) to authenticated;
-- Anyone signed in can see an emoji (so they render wherever they're used); members manage them.
drop policy if exists emojis_read on public.server_emojis;
create policy emojis_read on public.server_emojis for select to authenticated using (true);
drop policy if exists emojis_insert on public.server_emojis;
create policy emojis_insert on public.server_emojis for insert to authenticated
  with check (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS'))
              and public.server_emoji_count(server_id) < 100);
drop policy if exists emojis_delete on public.server_emojis;
create policy emojis_delete on public.server_emojis for delete to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_EXPRESSIONS')));
drop policy if exists not_banned on public.server_emojis;
create policy not_banned on public.server_emojis as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));
grant select, delete on public.server_emojis to authenticated;
grant insert (server_id, name, url, animated) on public.server_emojis to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('emojis', 'emojis', true, 524288)
on conflict (id) do nothing;
drop policy if exists "storage: emoji upload with MANAGE_EXPRESSIONS" on storage.objects;
create policy "storage: emoji upload with MANAGE_EXPRESSIONS" on storage.objects for insert to authenticated
  with check (bucket_id = 'emojis'
              and public.has_server_permission(((storage.foldername(name))[1])::uuid, public.permission_bit('MANAGE_EXPRESSIONS')));

-- -------------------------------------------------------------------------------------------
-- 6. Ban guard for the new tables, privileges
-- -------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['push_subscriptions', 'channel_webhooks', 'server_emojis'] loop
    execute format('drop trigger if exists zz_block_banned on public.%I', t);
    execute format('create trigger zz_block_banned before insert or update on public.%I for each row execute function public.block_banned_writes()', t);
  end loop;
end;
$$;

revoke all on function public.push_on_message(), public.discover_servers(text, text), public.join_discoverable(uuid),
                       public.webhook_post(uuid, text, text, text, text)
  from public;
grant execute on function public.discover_servers(text, text), public.join_discoverable(uuid) to authenticated;
grant execute on function public.webhook_post(uuid, text, text, text, text) to anon, authenticated;
