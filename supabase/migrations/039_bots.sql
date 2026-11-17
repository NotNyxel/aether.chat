-- 039: bots and the developer platform (2.1).
--
-- Anyone can make an app ("bot") in Settings → Developer. It gets:
--   * a token (shown once; only its SHA-256 is stored) to post messages through the bot API
--     (edge function bot-api → bot_post below), and
--   * a signing secret, used to sign the slash-command requests Aether sends to the app's HTTPS
--     interactions URL (edge function bot-interact), so the app can tell they're really from us.
-- People who can manage a server add apps to it; their commands then show up there.

create table if not exists public.bots (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references public.users (id) on delete cascade,
  name             text not null check (name ~ '^[A-Za-z0-9 _.-]{2,32}$'),
  description      text check (description is null or char_length(description) <= 300),
  avatar_url       text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500)),
  interactions_url text check (interactions_url is null or (interactions_url ~ '^https://' and char_length(interactions_url) <= 500)),
  public           boolean not null default false,
  token_hash       text not null,
  signing_secret   text not null,
  minute_start     timestamptz not null default now(),
  uses_minute      integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists bots_owner on public.bots (owner_id);
create unique index if not exists bots_token_hash on public.bots (token_hash);

create table if not exists public.bot_commands (
  bot_id      uuid not null references public.bots (id) on delete cascade,
  name        text not null check (name ~ '^[a-z0-9_-]{1,32}$'),
  description text not null default '' check (char_length(description) <= 100),
  primary key (bot_id, name)
);

create table if not exists public.server_bots (
  server_id uuid not null references public.servers (id) on delete cascade,
  bot_id    uuid not null references public.bots (id) on delete cascade,
  added_by  uuid references public.users (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (server_id, bot_id)
);
create index if not exists server_bots_bot on public.server_bots (bot_id);
create index if not exists server_bots_added_by on public.server_bots (added_by);

-- Who can see an app: its owner, anyone if it's public, and members of servers it's in.
create or replace function public.can_see_bot(p_bot uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bots b
     where b.id = p_bot
       and (b.owner_id = auth.uid() or b.public
            or exists (select 1 from public.server_bots sb where sb.bot_id = b.id and public.is_server_member(sb.server_id)))
  )
$$;
revoke all on function public.can_see_bot(uuid) from public, anon;
grant execute on function public.can_see_bot(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['bots', 'bot_commands', 'server_bots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
    execute format('drop policy if exists not_banned on public.%I', t);
    execute format('create policy not_banned on public.%I as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

drop policy if exists see on public.bots;
create policy see on public.bots for select to authenticated using (public.can_see_bot(id));
drop policy if exists edit_own on public.bots;
create policy edit_own on public.bots for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists delete_own on public.bots;
create policy delete_own on public.bots for delete to authenticated using (owner_id = (select auth.uid()));
-- The secrets never leave the database through the API (no column grant).
grant select (id, owner_id, name, description, avatar_url, interactions_url, public, created_at) on public.bots to authenticated;
grant update (name, description, avatar_url, interactions_url, public) on public.bots to authenticated;
grant delete on public.bots to authenticated;

create or replace function public.bot_command_count(p_bot uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.bot_commands where bot_id = p_bot
$$;
revoke all on function public.bot_command_count(uuid) from public, anon;
grant execute on function public.bot_command_count(uuid) to authenticated;

drop policy if exists see on public.bot_commands;
create policy see on public.bot_commands for select to authenticated using (public.can_see_bot(bot_id));
drop policy if exists manage on public.bot_commands;
create policy manage on public.bot_commands for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));
drop policy if exists command_limit on public.bot_commands;
create policy command_limit on public.bot_commands as restrictive for insert to authenticated with check (public.bot_command_count(bot_id) < 25);
grant select, insert, update, delete on public.bot_commands to authenticated;

create or replace function public.server_bot_count(p_server uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.server_bots where server_id = p_server
$$;
revoke all on function public.server_bot_count(uuid) from public, anon;
grant execute on function public.server_bot_count(uuid) to authenticated;

drop policy if exists see on public.server_bots;
create policy see on public.server_bots for select to authenticated using (public.is_server_member(server_id));
-- Add: you manage the server, and the app is public or yours.
drop policy if exists add on public.server_bots;
create policy add on public.server_bots for insert to authenticated
  with check (added_by = (select auth.uid())
              and public.has_server_permission(server_id, public.permission_bit('MANAGE_SERVER'))
              and exists (select 1 from public.bots b where b.id = bot_id and (b.public or b.owner_id = (select auth.uid())))
              and public.server_bot_count(server_id) < 20);
-- Remove: server managers, or the app's owner.
drop policy if exists remove on public.server_bots;
create policy remove on public.server_bots for delete to authenticated
  using (public.has_server_permission(server_id, public.permission_bit('MANAGE_SERVER'))
         or exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));
grant select, delete on public.server_bots to authenticated;
grant insert (server_id, bot_id, added_by) on public.server_bots to authenticated;

-- ── Creating apps and their secrets ───────────────────────────────────────────────────────────
create or replace function public.new_secret(p_prefix text)
returns text language sql volatile set search_path = '' as $$
  select p_prefix || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;
revoke all on function public.new_secret(text) from public, anon, authenticated;

create or replace function public.hash_token(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;
revoke all on function public.hash_token(text) from public, anon, authenticated;

-- Returns the token once. At most 10 apps each.
create or replace function public.create_bot(p_name text, p_description text default null)
returns table (id uuid, token text) language plpgsql security definer set search_path = '' as $$
declare v_token text := public.new_secret('aeb_'); v_id uuid;
begin
  if auth.uid() is null or public.is_banned() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if (select count(*) from public.bots b where b.owner_id = auth.uid()) >= 10 then
    raise exception 'You can have up to 10 apps.' using errcode = 'P0001';
  end if;
  insert into public.bots (owner_id, name, description, token_hash, signing_secret)
  values (auth.uid(), btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), public.hash_token(v_token), public.new_secret('aes_'))
  returning bots.id into v_id;
  return query select v_id, v_token;
end;
$$;

create or replace function public.reset_bot_token(p_bot uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text := public.new_secret('aeb_');
begin
  update public.bots set token_hash = public.hash_token(v_token) where id = p_bot and owner_id = auth.uid();
  if not found then raise exception 'App not found.' using errcode = 'P0002'; end if;
  return v_token;
end;
$$;

create or replace function public.bot_signing_secret(p_bot uuid)
returns text language sql stable security definer set search_path = '' as $$
  select signing_secret from public.bots where id = p_bot and owner_id = auth.uid()
$$;

revoke all on function public.create_bot(text, text), public.reset_bot_token(uuid), public.bot_signing_secret(uuid) from public, anon;
grant execute on function public.create_bot(text, text), public.reset_bot_token(uuid), public.bot_signing_secret(uuid) to authenticated;

-- ── Posting as an app ─────────────────────────────────────────────────────────────────────────
-- Shared by the bot API (token) and command replies (bot-interact, service role).
create or replace function public.bot_insert_message(p_bot public.bots, p_channel uuid, p_content text, p_invoker uuid, p_command text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_msg uuid; v_server uuid;
begin
  select c.server_id into v_server from public.channels c where c.id = p_channel and c.type = 'text';
  if v_server is null or not exists (select 1 from public.server_bots sb where sb.server_id = v_server and sb.bot_id = p_bot.id) then
    raise exception 'This app isn’t in that channel’s server.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_content, '')) = '' then raise exception 'Empty message.' using errcode = '22023'; end if;
  if p_bot.minute_start < now() - interval '1 minute' then
    update public.bots set minute_start = now(), uses_minute = 1 where id = p_bot.id;
  elsif p_bot.uses_minute >= 30 then
    raise exception 'Slow down: 30 messages a minute per app.' using errcode = 'P0001';
  else
    update public.bots set uses_minute = uses_minute + 1 where id = p_bot.id;
  end if;
  perform set_config('aether.crosspost', '1', true);
  insert into public.messages (channel_id, author_id, content, is_bot, bot_invoker_id, bot_command, bot_name, bot_avatar)
  values (p_channel, null, left(p_content, 4000), true, p_invoker, coalesce(p_command, 'app'), p_bot.name, p_bot.avatar_url)
  returning id into v_msg;
  perform set_config('aether.crosspost', '0', true);
  return v_msg;
end;
$$;
revoke all on function public.bot_insert_message(public.bots, uuid, text, uuid, text) from public, anon, authenticated;

create or replace function public.bot_post(p_token text, p_channel uuid, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.bots;
begin
  select * into b from public.bots where token_hash = public.hash_token(p_token) for update;
  if b.id is null then raise exception 'Invalid app token.' using errcode = '42501'; end if;
  return public.bot_insert_message(b, p_channel, p_content, null, 'app');
end;
$$;
revoke all on function public.bot_post(text, uuid, text) from public;
grant execute on function public.bot_post(text, uuid, text) to anon, authenticated;

-- Which servers and channels an app is in (for the bot API's GET /me).
create or replace function public.bot_me(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bots;
begin
  select * into b from public.bots where token_hash = public.hash_token(p_token);
  if b.id is null then raise exception 'Invalid app token.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', b.id, 'name', b.name,
    'servers', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'channels',
               (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.position), '[]'::jsonb)
                  from public.channels c where c.server_id = s.id and c.type = 'text')))
        from public.server_bots sb join public.servers s on s.id = sb.server_id where sb.bot_id = b.id), '[]'::jsonb));
end;
$$;
revoke all on function public.bot_me(text) from public;
grant execute on function public.bot_me(text) to anon, authenticated;

-- ── Slash commands ────────────────────────────────────────────────────────────────────────────
-- Called (as the user) by bot-interact before it contacts the app: checks the user may post in
-- the channel and the command belongs to an app in that server. Returns the app.
create or replace function public.check_bot_command(p_channel uuid, p_bot uuid, p_command text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_server uuid;
begin
  select c.server_id into v_server from public.channels c where c.id = p_channel;
  if v_server is null or not public.has_channel_permission(p_channel, public.permission_bit('SEND_MESSAGES')) then
    raise exception 'You can’t use commands here.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.server_bots sb join public.bot_commands bc on bc.bot_id = sb.bot_id
                  where sb.server_id = v_server and sb.bot_id = p_bot and bc.name = p_command) then
    raise exception 'Unknown command.' using errcode = 'P0002';
  end if;
  return v_server;
end;
$$;
revoke all on function public.check_bot_command(uuid, uuid, text) from public, anon;
grant execute on function public.check_bot_command(uuid, uuid, text) to authenticated;

-- The app's answer to a command, posted by bot-interact (service role only).
create or replace function public.bot_reply(p_bot uuid, p_channel uuid, p_invoker uuid, p_command text, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.bots;
begin
  select * into b from public.bots where id = p_bot for update;
  if b.id is null then raise exception 'App not found.' using errcode = 'P0002'; end if;
  return public.bot_insert_message(b, p_channel, p_content, p_invoker, p_command);
end;
$$;
revoke all on function public.bot_reply(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.bot_reply(uuid, uuid, uuid, text, text) to service_role;
