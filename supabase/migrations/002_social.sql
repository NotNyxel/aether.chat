-- =====================================================================================
-- AetherChat migration 002: social layer
--   friends + blocks · DMs + group DMs · DM/group calls · reactions · presence status
--   message replies/edits in DMs · DM attachments · Realtime topic authorization
--
-- Run ONCE in the Supabase SQL editor after supabase/schema.sql.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Types & profile presence
-- -------------------------------------------------------------------------------------
create type public.conversation_type as enum ('dm', 'group');
create type public.friendship_status as enum ('pending', 'accepted');

alter table public.users
  add column presence_status text not null default 'online'
    check (presence_status in ('online', 'idle', 'dnd', 'invisible'));
grant update (presence_status) on public.users to authenticated;

-- -------------------------------------------------------------------------------------
-- 2. Tables
-- -------------------------------------------------------------------------------------
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users (id) on delete cascade,
  addressee_id uuid not null references public.users (id) on delete cascade,
  status       public.friendship_status not null default 'pending',
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  check (requester_id <> addressee_id)
);
-- One relationship row per unordered pair.
create unique index friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id);

create table public.user_blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  type            public.conversation_type not null,
  name            text check (char_length(btrim(name)) between 1 and 100),
  icon_url        text check (icon_url ~ '^https://'),
  owner_id        uuid references public.users (id) on delete set null,  -- group owner
  dm_key          text unique,                                            -- "<low uuid>:<high uuid>" for 1:1 DMs
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  check ((type = 'dm') = (dm_key is not null))
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  hidden          boolean not null default false,   -- DM closed from the sidebar
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  started_by      uuid default auth.uid() references public.users (id) on delete set null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);
create unique index calls_one_active_idx on public.calls (conversation_id) where ended_at is null;

-- Messages can now target a server channel OR a conversation.
alter table public.messages alter column channel_id drop not null;
alter table public.messages add column conversation_id uuid references public.conversations (id) on delete cascade;
alter table public.messages add constraint messages_single_target check ((channel_id is null) <> (conversation_id is null));
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc, id desc)
  where conversation_id is not null;
grant insert (conversation_id) on public.messages to authenticated;

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 32),
  scope_id   uuid not null,  -- channel or conversation id (denormalized for Realtime filters)
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index message_reactions_scope_idx on public.message_reactions (scope_id);

-- -------------------------------------------------------------------------------------
-- 3. Helper functions
-- -------------------------------------------------------------------------------------
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  )
$$;

create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
     where f.status = 'accepted'
       and least(f.requester_id, f.addressee_id) = least(p_a, p_b)
       and greatest(f.requester_id, f.addressee_id) = greatest(p_a, p_b)
  )
$$;

create or replace function public.shares_server(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.server_members m1
      join public.server_members m2 on m2.server_id = m1.server_id
     where m1.user_id = p_a and m2.user_id = p_b
  )
$$;

create or replace function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_members cm
     where cm.conversation_id = p_conversation_id and cm.user_id = p_user_id
  )
$$;

-- Member of the conversation, and (for 1:1 DMs) nobody in it has blocked the other.
create or replace function public.can_use_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_conversation_member(p_conversation_id)
     and not exists (
       select 1
         from public.conversations c
         join public.conversation_members other
           on other.conversation_id = c.id and other.user_id <> auth.uid()
        where c.id = p_conversation_id
          and c.type = 'dm'
          and public.is_blocked_between(auth.uid(), other.user_id)
     )
$$;

-- A scope is either a server channel or a conversation (ids are random UUIDs, never collide).
create or replace function public.can_read_scope(p_scope_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_scope_id is not null and (
    public.is_conversation_member(p_scope_id)
    or public.has_channel_permission(p_scope_id, public.permission_bit('VIEW_CHANNEL'))
  )
$$;

create or replace function public.can_read_message(p_message_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when m.channel_id is not null
        then public.has_channel_permission(m.channel_id, public.permission_bit('VIEW_CHANNEL'))
      else public.is_conversation_member(m.conversation_id)
    end
    from public.messages m where m.id = p_message_id
  ), false)
$$;

-- Voice rooms: server voice/stream channels need CONNECT; conversations need membership (+ no block).
create or replace function public.can_join_voice_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid := public.try_uuid(substring(p_topic from '^voice:(.+)$'));
begin
  if v_id is null then
    return false;
  end if;
  if exists (select 1 from public.channels c where c.id = v_id and c.type in ('voice', 'stream')) then
    return public.has_channel_permission(v_id, public.permission_bit('CONNECT'));
  end if;
  return public.can_use_conversation(v_id);
end;
$$;

-- Every private Realtime topic the client uses.
create or replace function public.can_access_realtime_topic(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_topic = 'online:global' then auth.uid() is not null
    when p_topic like 'voice:%'    then public.can_join_voice_topic(p_topic)
    when p_topic like 'typing:%'   then public.can_read_scope(public.try_uuid(substring(p_topic from '^typing:(.+)$')))
    else false
  end
$$;

-- -------------------------------------------------------------------------------------
-- 4. RPCs — friends & blocks
-- -------------------------------------------------------------------------------------
create or replace function public.send_friend_request(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := auth.uid();
  v_target uuid;
  v_row    public.friendships%rowtype;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select u.id into v_target from public.users u where u.username = btrim(p_username)::extensions.citext;
  if v_target is null then raise exception 'No user with that username.' using errcode = 'P0002'; end if;
  if v_target = v_me then raise exception 'You cannot add yourself.' using errcode = 'P0001'; end if;
  if public.is_blocked_between(v_me, v_target) then
    raise exception 'You cannot send a friend request to this user.' using errcode = '42501';
  end if;

  select * into v_row from public.friendships f
   where least(f.requester_id, f.addressee_id) = least(v_me, v_target)
     and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_target)
   for update;

  if found then
    if v_row.status = 'accepted' then return 'already_friends'; end if;
    if v_row.requester_id = v_target then
      update public.friendships set status = 'accepted', accepted_at = now() where id = v_row.id;
      return 'accepted';
    end if;
    return 'already_sent';
  end if;

  insert into public.friendships (requester_id, addressee_id) values (v_me, v_target);
  return 'sent';
end;
$$;

create or replace function public.accept_friend_request(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.friendships
     set status = 'accepted', accepted_at = now()
   where requester_id = p_user_id and addressee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'No pending request from that user.' using errcode = 'P0002'; end if;
end;
$$;

-- Unfriend, cancel an outgoing request, or decline an incoming one.
create or replace function public.remove_friend(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friendships f
   where least(f.requester_id, f.addressee_id) = least(auth.uid(), p_user_id)
     and greatest(f.requester_id, f.addressee_id) = greatest(auth.uid(), p_user_id)
$$;

create or replace function public.block_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id = auth.uid() then raise exception 'You cannot block yourself.' using errcode = 'P0001'; end if;
  perform public.remove_friend(p_user_id);
  insert into public.user_blocks (blocker_id, blocked_id) values (auth.uid(), p_user_id) on conflict do nothing;
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_user_id
$$;

-- -------------------------------------------------------------------------------------
-- 5. RPCs — conversations
-- -------------------------------------------------------------------------------------
-- Opens (or re-opens) the 1:1 DM with a friend or anyone you share a server with.
create or replace function public.open_dm(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := auth.uid();
  v_key  text;
  v_conv uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_user_id = v_me then raise exception 'You cannot message yourself.' using errcode = 'P0001'; end if;
  if public.is_blocked_between(v_me, p_user_id) then
    raise exception 'You cannot message this user.' using errcode = '42501';
  end if;

  v_key := least(v_me, p_user_id)::text || ':' || greatest(v_me, p_user_id)::text;
  select id into v_conv from public.conversations where dm_key = v_key;

  if v_conv is null then
    if not (public.are_friends(v_me, p_user_id) or public.shares_server(v_me, p_user_id)) then
      raise exception 'You can only message friends or people who share a server with you.' using errcode = '42501';
    end if;
    insert into public.conversations (type, dm_key) values ('dm', v_key)
      on conflict (dm_key) do nothing
      returning id into v_conv;
    if v_conv is null then
      select id into v_conv from public.conversations where dm_key = v_key;
    else
      insert into public.conversation_members (conversation_id, user_id) values (v_conv, v_me), (v_conv, p_user_id);
    end if;
  end if;

  update public.conversation_members set hidden = false where conversation_id = v_conv and user_id = v_me;
  return v_conv;
end;
$$;

create or replace function public.create_group_dm(p_user_ids uuid[], p_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := auth.uid();
  v_ids  uuid[];
  v_conv uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct u), '{}') into v_ids from unnest(p_user_ids) as u where u <> v_me;

  if cardinality(v_ids) < 1 then raise exception 'Pick at least one friend.' using errcode = 'P0001'; end if;
  if cardinality(v_ids) + 1 > 10 then raise exception 'Group DMs are limited to 10 people.' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(v_ids) as u where not public.are_friends(v_me, u)) then
    raise exception 'You can only add friends to a group.' using errcode = '42501';
  end if;

  insert into public.conversations (type, name, owner_id)
  values ('group', nullif(btrim(coalesce(p_name, '')), ''), v_me)
  returning id into v_conv;

  insert into public.conversation_members (conversation_id, user_id)
  select v_conv, u from unnest(array_append(v_ids, v_me)) as u;
  return v_conv;
end;
$$;

create or replace function public.add_group_member(p_conversation_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_type public.conversation_type;
begin
  select type into v_type from public.conversations where id = p_conversation_id;
  if v_type is distinct from 'group' or not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a group you are in.' using errcode = '42501';
  end if;
  if not public.are_friends(auth.uid(), p_user_id) then
    raise exception 'You can only add friends to a group.' using errcode = '42501';
  end if;
  if (select count(*) from public.conversation_members where conversation_id = p_conversation_id) >= 10 then
    raise exception 'Group DMs are limited to 10 people.' using errcode = 'P0001';
  end if;
  insert into public.conversation_members (conversation_id, user_id) values (p_conversation_id, p_user_id)
    on conflict do nothing;
end;
$$;

-- DMs are hidden (history kept); groups are left for real, with ownership handed over.
create or replace function public.leave_conversation(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_conv public.conversations%rowtype;
  v_next uuid;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if not found or not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a conversation you are in.' using errcode = '42501';
  end if;

  if v_conv.type = 'dm' then
    update public.conversation_members set hidden = true
     where conversation_id = p_conversation_id and user_id = auth.uid();
    return;
  end if;

  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid();
  select user_id into v_next from public.conversation_members
   where conversation_id = p_conversation_id order by joined_at limit 1;

  if v_next is null then
    delete from public.conversations where id = p_conversation_id;
  elsif v_conv.owner_id = auth.uid() then
    update public.conversations set owner_id = v_next where id = p_conversation_id;
  end if;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.conversation_members set last_read_at = now()
   where conversation_id = p_conversation_id and user_id = auth.uid()
$$;

-- -------------------------------------------------------------------------------------
-- 6. RPCs — calls (ringing is driven by Realtime INSERTs on public.calls)
-- -------------------------------------------------------------------------------------
create or replace function public.start_call(p_conversation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_call uuid;
begin
  if not public.can_use_conversation(p_conversation_id) then
    raise exception 'You cannot call this conversation.' using errcode = '42501';
  end if;
  select id into v_call from public.calls where conversation_id = p_conversation_id and ended_at is null;
  if v_call is null then
    insert into public.calls (conversation_id, started_by) values (p_conversation_id, auth.uid())
      on conflict (conversation_id) where ended_at is null do nothing
      returning id into v_call;
    if v_call is null then
      select id into v_call from public.calls where conversation_id = p_conversation_id and ended_at is null;
    end if;
  end if;
  return v_call;
end;
$$;

create or replace function public.end_call(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a conversation you are in.' using errcode = '42501';
  end if;
  update public.calls set ended_at = now() where conversation_id = p_conversation_id and ended_at is null;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 7. Message triggers (replace originals to support conversations)
-- -------------------------------------------------------------------------------------
create or replace function public.validate_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_type      public.channel_type;
  v_rate      integer;
  v_last_sent timestamptz;
begin
  new.author_id  := auth.uid();
  new.created_at := now();
  new.edited_at  := null;
  new.pinned     := false;

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
     and old.channel_id is not null
     and not public.has_channel_permission(old.channel_id, public.permission_bit('MANAGE_MESSAGES')) then
    raise exception 'MANAGE_MESSAGES required to pin' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Bump conversation activity, unhide it for everyone, and mark it read for the sender.
create or replace function public.after_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.conversation_id is not null then
    update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
    update public.conversation_members
       set hidden = false,
           last_read_at = case when user_id = new.author_id then new.created_at else last_read_at end
     where conversation_id = new.conversation_id;
  end if;
  return null;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.after_message_insert();

create or replace function public.prepare_reaction()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := auth.uid();
  select coalesce(m.channel_id, m.conversation_id) into new.scope_id from public.messages m where m.id = new.message_id;
  if (select count(distinct r.emoji) from public.message_reactions r where r.message_id = new.message_id) >= 20
     and not exists (select 1 from public.message_reactions r where r.message_id = new.message_id and r.emoji = new.emoji) then
    raise exception 'A message can have at most 20 different reactions.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger message_reactions_prepare
  before insert on public.message_reactions
  for each row execute function public.prepare_reaction();

-- -------------------------------------------------------------------------------------
-- 8. Privileges
-- -------------------------------------------------------------------------------------
revoke all on public.friendships, public.user_blocks, public.conversations, public.conversation_members,
              public.calls, public.message_reactions from anon, authenticated;

grant select on public.friendships, public.user_blocks, public.conversation_members, public.calls to authenticated;
grant select on public.conversations to authenticated;
grant update (name, icon_url) on public.conversations to authenticated;
grant select, delete on public.message_reactions to authenticated;
grant insert (message_id, emoji) on public.message_reactions to authenticated;

revoke all on function
  public.is_blocked_between(uuid, uuid), public.are_friends(uuid, uuid), public.shares_server(uuid, uuid),
  public.is_conversation_member(uuid, uuid), public.can_use_conversation(uuid), public.can_read_scope(uuid),
  public.can_read_message(uuid), public.can_access_realtime_topic(text),
  public.send_friend_request(text), public.accept_friend_request(uuid), public.remove_friend(uuid),
  public.block_user(uuid), public.unblock_user(uuid), public.open_dm(uuid), public.create_group_dm(uuid[], text),
  public.add_group_member(uuid, uuid), public.leave_conversation(uuid), public.mark_conversation_read(uuid),
  public.start_call(uuid), public.end_call(uuid),
  public.after_message_insert(), public.prepare_reaction()
from public, anon;

grant execute on function
  public.is_blocked_between(uuid, uuid), public.are_friends(uuid, uuid), public.shares_server(uuid, uuid),
  public.is_conversation_member(uuid, uuid), public.can_use_conversation(uuid), public.can_read_scope(uuid),
  public.can_read_message(uuid), public.can_access_realtime_topic(text), public.can_join_voice_topic(text),
  public.send_friend_request(text), public.accept_friend_request(uuid), public.remove_friend(uuid),
  public.block_user(uuid), public.unblock_user(uuid), public.open_dm(uuid), public.create_group_dm(uuid[], text),
  public.add_group_member(uuid, uuid), public.leave_conversation(uuid), public.mark_conversation_read(uuid),
  public.start_call(uuid), public.end_call(uuid)
to authenticated;

-- -------------------------------------------------------------------------------------
-- 9. Row-Level Security
-- -------------------------------------------------------------------------------------
alter table public.friendships          enable row level security;
alter table public.user_blocks          enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.calls                enable row level security;
alter table public.message_reactions    enable row level security;

create policy "friendships: participants can read"
  on public.friendships for select to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

create policy "blocks: blocker can read own list"
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy "conversations: members can read"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));

create policy "conversations: members can rename groups"
  on public.conversations for update to authenticated
  using (type = 'group' and public.is_conversation_member(id))
  with check (type = 'group' and public.is_conversation_member(id));

create policy "conversation_members: visible to fellow members"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "calls: members can read"
  on public.calls for select to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "messages: conversation members read"
  on public.messages for select to authenticated
  using (conversation_id is not null and public.is_conversation_member(conversation_id));

create policy "messages: conversation members post"
  on public.messages for insert to authenticated
  with check (
    conversation_id is not null
    and author_id = (select auth.uid())
    and public.can_use_conversation(conversation_id)
  );

-- Content edits are author-only (enforced by validate_message_update); members may pin.
create policy "messages: conversation members update"
  on public.messages for update to authenticated
  using (conversation_id is not null and public.is_conversation_member(conversation_id))
  with check (conversation_id is not null and public.is_conversation_member(conversation_id));

create policy "reactions: readable with the message"
  on public.message_reactions for select to authenticated
  using (public.can_read_scope(scope_id));

create policy "reactions: add on readable messages"
  on public.message_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_read_message(message_id));

create policy "reactions: remove own"
  on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- -------------------------------------------------------------------------------------
-- 10. Realtime
-- -------------------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.friendships, public.conversations, public.conversation_members, public.calls, public.message_reactions;

drop policy if exists "realtime: voice room receive requires CONNECT" on realtime.messages;
drop policy if exists "realtime: voice room send requires CONNECT" on realtime.messages;

create policy "realtime: private topics (receive)"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_realtime_topic((select realtime.topic()))
  );

create policy "realtime: private topics (send)"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_realtime_topic((select realtime.topic()))
  );

-- -------------------------------------------------------------------------------------
-- 11. Storage: DM attachments live under attachments/<conversation_id>/…
-- -------------------------------------------------------------------------------------
create policy "storage: read DM attachments as a member"
  on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_conversation_member(public.try_uuid((storage.foldername(name))[1])));

create policy "storage: upload DM attachments as a member"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_use_conversation(public.try_uuid((storage.foldername(name))[1])));
