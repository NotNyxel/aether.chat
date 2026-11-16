-- Aether 1.9.2: moderation tools. Run after 024.
--   * AutoMod: two new rule types. "invite" blocks invite links to other servers; "caps" blocks
--     messages that are mostly capital letters.
--   * Lock chat: moderators can pause chatting for everyone else (raids, heated moments), for a set
--     time or until unlocked.
--   * Minimum account age to join (on top of the verification levels).
--   * Bulk delete: remove the latest messages in a channel, optionally only from one person.

-- ── AutoMod ─────────────────────────────────────────────────────────────────────────────────
alter table public.automod_rules drop constraint if exists automod_rules_trigger_check;
alter table public.automod_rules add constraint automod_rules_trigger_check check (trigger in ('keyword', 'link', 'mention', 'spam', 'invite', 'caps'));
alter table public.automod_rules add column if not exists caps_percent integer not null default 70 check (caps_percent between 50 and 100);

-- Invite links that lead somewhere other than this server.
create or replace function public.automod_invite_match(p_content text, p_server uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_code text;
begin
  for v_code in
    select m[1] from regexp_matches(coalesce(p_content, ''),
      '(?:aether\.chat/inv/|aetherchat://inv/|\.vercel\.app/inv/|github\.io/aether\.chat-releases/inv/#|discord\.gg/|discord(?:app)?\.com/invite/)([A-Za-z0-9_-]{2,64})', 'gi') as m
  loop
    if not exists (select 1 from public.server_invites i where i.code = v_code and i.server_id = p_server) then
      return 'invite link: ' || v_code;
    end if;
  end loop;
  return null;
end;
$$;

-- Mostly capital letters (only for messages with at least 12 letters, so "OK" or "LOL" are fine).
create or replace function public.automod_caps_match(p_content text, p_percent integer)
returns text language plpgsql immutable set search_path = '' as $$
declare v_letters integer; v_upper integer; v_text text;
begin
  -- Ignore mentions, emoji codes and links, which aren't shouting.
  v_text := regexp_replace(coalesce(p_content, ''), '<[^>]*>|:[a-z0-9_+-]+:|https?://\S+', '', 'gi');
  v_letters := char_length(regexp_replace(v_text, '[^[:alpha:]]', '', 'g'));
  if v_letters < 12 then return null; end if;
  v_upper := char_length(regexp_replace(v_text, '[^[:upper:]]', '', 'g'));
  if v_upper * 100 >= v_letters * p_percent then
    return round(v_upper * 100.0 / v_letters) || '% capital letters';
  end if;
  return null;
end;
$$;

create or replace function public.automod_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_server  uuid;
  v_rule    public.automod_rules;
  v_matched text;
  v_roles   uuid[];
  v_count   integer;
begin
  if new.channel_id is null or current_setting('aether.crosspost', true) = '1' then return new; end if;
  select coalesce(p.server_id, c.server_id) into v_server
    from public.channels c left join public.channels p on p.id = c.thread_parent_id where c.id = new.channel_id;
  if v_server is null or public.has_server_permission(v_server, public.permission_bit('MANAGE_SERVER')) then
    return new;  -- server managers (and the owner) are exempt
  end if;
  select coalesce(array_agg(role_id), '{}') into v_roles from public.member_roles where server_id = v_server and user_id = new.author_id;

  for v_rule in
    select * from public.automod_rules r
     where r.server_id = v_server and r.enabled
       and not (new.channel_id = any (r.exempt_channels))
       and not (r.exempt_roles && v_roles)
     order by r.created_at
  loop
    v_matched := null;
    if v_rule.trigger = 'keyword' then
      v_matched := public.automod_keyword_match(new.content, v_rule.keywords, v_rule.allow_list);
    elsif v_rule.trigger = 'link' then
      v_matched := public.automod_link_match(new.content, v_rule.allow_list);
    elsif v_rule.trigger = 'invite' then
      v_matched := public.automod_invite_match(new.content, v_server);
    elsif v_rule.trigger = 'caps' then
      v_matched := public.automod_caps_match(new.content, v_rule.caps_percent);
    elsif v_rule.trigger = 'mention' then
      v_count := coalesce(cardinality(new.mentions), 0) + coalesce(cardinality(new.mention_roles), 0) + case when new.mention_everyone then 1 else 0 end;
      if v_count > v_rule.mention_limit then v_matched := v_count || ' mentions'; end if;
    elsif v_rule.trigger = 'spam' then
      select count(*) into v_count from public.messages m join public.channels c on c.id = m.channel_id
       where m.author_id = new.author_id and m.created_at > now() - interval '5 seconds'
         and (c.server_id = v_server);
      if v_count >= 5 then
        v_matched := 'flooding (5+ messages in 5 seconds)';
      elsif btrim(coalesce(new.content, '')) <> '' then
        select count(*) into v_count from public.messages m
         where m.author_id = new.author_id and m.content = new.content and m.created_at > now() - interval '30 seconds';
        if v_count >= 2 then v_matched := 'repeated message'; end if;
      end if;
    end if;

    if v_matched is not null then
      insert into public.automod_events (server_id, rule_id, rule_name, user_id, channel_id, content, matched, action)
      values (v_server, v_rule.id, v_rule.name, new.author_id, new.channel_id, left(new.content, 2000), v_matched, v_rule.action);
      if v_rule.action = 'block_and_timeout' then
        update public.server_members set timed_out_until = greatest(coalesce(timed_out_until, now()), now() + make_interval(mins => v_rule.timeout_minutes))
         where server_id = v_server and user_id = new.author_id;
      end if;
      if v_rule.action in ('block', 'block_and_timeout') then
        return null;  -- drop the message; the sender's app reads the event to explain why
      end if;
    end if;
  end loop;
  return new;
end;
$$;

-- ── Lock chat and minimum account age ──────────────────────────────────────────────────────
alter table public.servers
  add column if not exists chat_locked_until timestamptz,
  add column if not exists min_account_days  integer not null default 0 check (min_account_days between 0 and 365);
grant update (min_account_days) on public.servers to authenticated;

-- Moderators (Moderate Members or Manage Server) lock chat for p_minutes, or until unlocked
-- (p_minutes = null), or unlock (p_minutes = 0).
create or replace function public.set_chat_lock(p_server_id uuid, p_minutes integer)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_until timestamptz;
begin
  if not (public.has_server_permission(p_server_id, public.permission_bit('MODERATE_MEMBERS'))
          or public.has_server_permission(p_server_id, public.permission_bit('MANAGE_SERVER'))) then
    raise exception 'You don''t have permission to lock chat here.' using errcode = '42501';
  end if;
  v_until := case when p_minutes = 0 then null when p_minutes is null then 'infinity'::timestamptz else now() + make_interval(mins => least(p_minutes, 40320)) end;
  update public.servers set chat_locked_until = v_until where id = p_server_id;
  perform public.write_audit(p_server_id, case when v_until is null then 'chat_unlock' else 'chat_lock' end, 'server', p_server_id, null,
                             jsonb_build_object('until', v_until));
  return v_until;
end;
$$;

-- While chat is locked, only people who can manage messages or moderate members can post.
create or replace function public.enforce_chat_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_server uuid; v_until timestamptz;
begin
  if new.channel_id is null or current_setting('aether.crosspost', true) = '1' or new.author_id is null then return new; end if;
  select coalesce(p.server_id, c.server_id) into v_server
    from public.channels c left join public.channels p on p.id = c.thread_parent_id where c.id = new.channel_id;
  select s.chat_locked_until into v_until from public.servers s where s.id = v_server;
  if v_until is null or v_until <= now() then return new; end if;
  if public.has_server_permission(v_server, public.permission_bit('MANAGE_MESSAGES'))
     or public.has_server_permission(v_server, public.permission_bit('MODERATE_MEMBERS')) then return new; end if;
  raise exception 'Chat is locked by the moderators right now.' using errcode = '42501';
end;
$$;
drop trigger if exists messages_zw_chat_lock on public.messages;
create trigger messages_zw_chat_lock before insert on public.messages
  for each row execute function public.enforce_chat_lock();

create or replace function public.enforce_server_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_level text; v_owner uuid; v_days integer; v_confirmed timestamptz; v_created timestamptz;
begin
  select s.verification_level, s.owner_id, s.min_account_days into v_level, v_owner, v_days from public.servers s where s.id = new.server_id;
  if new.user_id = v_owner then return new; end if;
  select a.email_confirmed_at, a.created_at into v_confirmed, v_created from auth.users a where a.id = new.user_id;
  if coalesce(v_days, 0) > 0 and v_created > now() - make_interval(days => v_days) then
    raise exception 'Your account needs to be at least % day(s) old to join this server.', v_days using errcode = '42501';
  end if;
  if coalesce(v_level, 'none') = 'none' then return new; end if;
  if v_confirmed is null then
    raise exception 'This server only lets in accounts with a verified email.' using errcode = '42501';
  end if;
  if v_level in ('medium', 'high') and v_created > now() - interval '5 minutes' then
    raise exception 'Your account needs to be at least 5 minutes old to join this server.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ── Bulk delete ───────────────────────────────────────────────────────────────────────────
-- Deletes the latest p_count (up to 200) messages in a channel, or only those from p_user.
create or replace function public.purge_messages(p_channel_id uuid, p_count integer, p_user uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_server uuid; v_n integer; v_name text;
begin
  select c.server_id, c.name into v_server, v_name from public.channels c where c.id = p_channel_id;
  if v_server is null or not public.has_channel_permission(p_channel_id, public.permission_bit('MANAGE_MESSAGES')) then
    raise exception 'You don''t have permission to delete messages here.' using errcode = '42501';
  end if;
  with doomed as (
    select m.id from public.messages m
     where m.channel_id = p_channel_id and (p_user is null or m.author_id = p_user)
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_count, 0), 200))
  )
  delete from public.messages m using doomed d where m.id = d.id;
  get diagnostics v_n = row_count;
  perform public.write_audit(v_server, 'messages_purge', 'channel', p_channel_id, v_name,
                             jsonb_build_object('count', v_n, 'user_id', p_user));
  return v_n;
end;
$$;

revoke all on function public.automod_invite_match(text, uuid), public.automod_caps_match(text, integer), public.set_chat_lock(uuid, integer),
                       public.purge_messages(uuid, integer, uuid) from public, anon;
grant execute on function public.set_chat_lock(uuid, integer), public.purge_messages(uuid, integer, uuid) to authenticated;
