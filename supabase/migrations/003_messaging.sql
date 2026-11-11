-- =====================================================================================
-- aether.chat migration 003: Batch 1 "Messaging power-ups" (v0.4.0)
--   polls + votes · pins (who/when) · full-text search · @mentions / @everyone tracking
--   forwarded messages · per-channel unread state · unread + mention summary RPC
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Validators
-- -------------------------------------------------------------------------------------
-- Normalized poll shape stored on messages.poll (the insert trigger builds it):
--   { "question": text, "options": [{ "text": text, "emoji": text|null }, …2-10],
--     "multi": bool, "expires_at": timestamptz }
create or replace function public.is_valid_poll(p jsonb)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and char_length(coalesce(p ->> 'question', '')) between 1 and 300
    and jsonb_typeof(p -> 'options') = 'array'
    and jsonb_array_length(p -> 'options') between 2 and 10
    and jsonb_typeof(p -> 'multi') = 'boolean'
    and (p ->> 'expires_at') is not null
    and not exists (
      select 1 from jsonb_array_elements(p -> 'options') as o(item)
       where jsonb_typeof(o.item) <> 'object'
          or char_length(coalesce(o.item ->> 'text', '')) not between 1 and 55
          or char_length(coalesce(o.item ->> 'emoji', '')) > 32
    )
  )
$$;

-- Attachments may now carry "spoiler": bool and "alt": text (≤ 1024 chars).
create or replace function public.is_valid_attachments(p_attachments jsonb)
returns boolean language sql immutable parallel safe set search_path = '' as $$
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
          or (a.item ? 'width'   and jsonb_typeof(a.item -> 'width')   is distinct from 'number')
          or (a.item ? 'height'  and jsonb_typeof(a.item -> 'height')  is distinct from 'number')
          or (a.item ? 'spoiler' and jsonb_typeof(a.item -> 'spoiler') is distinct from 'boolean')
          or (a.item ? 'alt'     and (jsonb_typeof(a.item -> 'alt') is distinct from 'string' or char_length(a.item ->> 'alt') > 1024))
     )
$$;

-- User ids @mentioned in a message body (by username).
create or replace function public.extract_mentions(p_content text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct u.id), '{}')
    from regexp_matches(coalesce(p_content, ''), '(?:^|[^A-Za-z0-9_@])@([A-Za-z0-9_.]{2,32})', 'g') as m(parts)
    join public.users u on u.username = (m.parts[1])::extensions.citext
$$;

-- -------------------------------------------------------------------------------------
-- 2. Columns & indexes
-- -------------------------------------------------------------------------------------
alter table public.messages
  add column poll             jsonb check (public.is_valid_poll(poll)),
  add column forwarded_from   jsonb check (forwarded_from is null or jsonb_typeof(forwarded_from) = 'object'),
  add column mentions         uuid[] not null default '{}',
  add column mention_everyone boolean not null default false,
  add column pinned_at        timestamptz,
  add column pinned_by        uuid references public.users (id) on delete set null;

-- A message needs text, attachments, a poll or a forward (replaces the original check).
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.messages'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%btrim%' and pg_get_constraintdef(oid) like '%jsonb_array_length(attachments)%'
  loop
    execute format('alter table public.messages drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.messages add constraint messages_has_body check (
  char_length(btrim(content)) > 0 or jsonb_array_length(attachments) > 0 or poll is not null or forwarded_from is not null
);

create index messages_search_idx   on public.messages using gin (to_tsvector('simple'::regconfig, content));
create index messages_mentions_idx on public.messages using gin (mentions);
create index messages_pinned_scope_idx on public.messages (coalesce(channel_id, conversation_id), pinned_at desc) where pinned;

grant insert (poll, forwarded_from) on public.messages to authenticated;

alter table public.channels add column last_message_at timestamptz;

create table public.channel_read_states (
  user_id      uuid not null references public.users (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create table public.poll_votes (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  option_id  smallint not null check (option_id between 0 and 9),
  scope_id   uuid not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, option_id)
);
create index poll_votes_scope_idx on public.poll_votes (scope_id);

-- -------------------------------------------------------------------------------------
-- 3. Message triggers (replace 002 versions)
-- -------------------------------------------------------------------------------------
create or replace function public.validate_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_type      public.channel_type;
  v_rate      integer;
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
    select c.type, c.rate_limit_seconds into v_type, v_rate from public.channels c where c.id = new.channel_id;
    if v_type is distinct from 'text' then
      raise exception 'messages can only be sent to text channels' using errcode = '23514';
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

  -- Polls: the client sends { question, options: [{text, emoji?}], multi, duration_hours }.
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

  -- Forwards: the client sends { message_id }. Verify the sender can read the original, then
  -- record where it came from.
  if new.forwarded_from is not null then
    v_src_id := public.try_uuid(new.forwarded_from ->> 'message_id');
    if v_src_id is null or not public.can_read_message(v_src_id) then
      raise exception 'You cannot forward that message.' using errcode = '42501';
    end if;
    select * into v_src from public.messages where id = v_src_id;
    new.forwarded_from := jsonb_build_object(
      'message_id', v_src.id,
      'author_id', v_src.author_id,
      'created_at', v_src.created_at,
      'channel_id', v_src.channel_id,
      'conversation_id', v_src.conversation_id
    );
  end if;

  new.mentions := public.extract_mentions(new.content);
  new.mention_everyone :=
    new.channel_id is not null
    and new.content ~ '(^|[^A-Za-z0-9_])@(everyone|here)([^A-Za-z0-9_]|$)'
    and public.has_channel_permission(new.channel_id, public.permission_bit('MENTION_EVERYONE'));
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
    new.edited_at := now();
    new.mentions := public.extract_mentions(new.content);
    new.mention_everyone :=
      old.mention_everyone
      or (new.channel_id is not null
          and new.content ~ '(^|[^A-Za-z0-9_])@(everyone|here)([^A-Za-z0-9_]|$)'
          and public.has_channel_permission(new.channel_id, public.permission_bit('MENTION_EVERYONE')));
  else
    new.mentions := old.mentions;
    new.mention_everyone := old.mention_everyone;
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

create or replace function public.after_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.conversation_id is not null then
    update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
    update public.conversation_members
       set hidden = false,
           last_read_at = case when user_id = new.author_id then new.created_at else last_read_at end
     where conversation_id = new.conversation_id;
  else
    update public.channels set last_message_at = new.created_at where id = new.channel_id;
    insert into public.channel_read_states (user_id, channel_id, last_read_at)
    values (new.author_id, new.channel_id, new.created_at)
    on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
  end if;
  return null;
end;
$$;

-- Posting a message updates channels.last_message_at; don't let that churn updated_at.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'channels' and (to_jsonb(new) - 'last_message_at' - 'updated_at') = (to_jsonb(old) - 'last_message_at' - 'updated_at') then
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 4. RPCs
-- -------------------------------------------------------------------------------------
create or replace function public.mark_channel_read(p_channel_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_channel_permission(p_channel_id, public.permission_bit('VIEW_CHANNEL')) then
    raise exception 'Not a channel you can see.' using errcode = '42501';
  end if;
  insert into public.channel_read_states (user_id, channel_id, last_read_at)
  values (auth.uid(), p_channel_id, now())
  on conflict (user_id, channel_id) do update set last_read_at = now();
end;
$$;

-- Unread state for every text channel and conversation the caller can see.
-- Channels never opened count as read up to the moment you joined the server.
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
              and ((select id from me) = any (m.mentions) or m.mention_everyone)
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

create or replace function public.vote_poll(p_message_id uuid, p_option_ids smallint[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_poll  jsonb;
  v_scope uuid;
  v_count integer;
begin
  if not public.can_read_message(p_message_id) then
    raise exception 'Poll not found.' using errcode = 'P0002';
  end if;
  select m.poll, coalesce(m.channel_id, m.conversation_id) into v_poll, v_scope from public.messages m where m.id = p_message_id;
  if v_poll is null then raise exception 'That message has no poll.' using errcode = 'P0002'; end if;
  if (v_poll ->> 'expires_at')::timestamptz <= now() then raise exception 'This poll has ended.' using errcode = 'P0001'; end if;

  v_count := jsonb_array_length(v_poll -> 'options');
  p_option_ids := coalesce((select array_agg(distinct o) from unnest(p_option_ids) o), '{}');
  if exists (select 1 from unnest(p_option_ids) o where o < 0 or o >= v_count) then
    raise exception 'Invalid poll option.' using errcode = '23514';
  end if;
  if not (v_poll ->> 'multi')::boolean and cardinality(p_option_ids) > 1 then
    raise exception 'This poll allows only one answer.' using errcode = '23514';
  end if;

  delete from public.poll_votes where message_id = p_message_id and user_id = auth.uid();
  insert into public.poll_votes (message_id, user_id, option_id, scope_id)
  select p_message_id, auth.uid(), o, v_scope from unnest(p_option_ids) o;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 5. Privileges, RLS, Realtime
-- -------------------------------------------------------------------------------------
revoke all on public.channel_read_states, public.poll_votes from anon, authenticated;
grant select on public.channel_read_states, public.poll_votes to authenticated;

revoke all on function public.is_valid_poll(jsonb), public.extract_mentions(text), public.mark_channel_read(uuid),
                       public.unread_summary(), public.vote_poll(uuid, smallint[]) from public, anon;
grant execute on function public.is_valid_poll(jsonb), public.is_valid_attachments(jsonb), public.extract_mentions(text),
                          public.mark_channel_read(uuid), public.unread_summary(), public.vote_poll(uuid, smallint[])
  to authenticated;

alter table public.channel_read_states enable row level security;
alter table public.poll_votes          enable row level security;

create policy "read states: own rows"
  on public.channel_read_states for select to authenticated
  using (user_id = (select auth.uid()));

create policy "poll votes: visible with the poll"
  on public.poll_votes for select to authenticated
  using (public.can_read_scope(scope_id));

alter publication supabase_realtime add table public.poll_votes;
