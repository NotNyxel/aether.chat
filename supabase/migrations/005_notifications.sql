-- aether.chat Batch 3: notifications & presence (v0.6.0)
--   * per-server / per-channel / per-conversation notification settings (level, mute, @everyone suppression)
--   * unread_summary() honours "Nothing" and "Suppress @everyone"
--   * custom status expiry
--   * recent_mentions() for the inbox
-- Idempotent where practical; run after 004_server_management.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Notification settings
-- -------------------------------------------------------------------------------------------
create table if not exists public.notification_settings (
  user_id           uuid not null default auth.uid() references public.users (id) on delete cascade,
  scope_id          uuid not null,
  scope_kind        text not null check (scope_kind in ('server', 'channel', 'conversation')),
  -- null = inherit (channel → server → default). Servers default to 'mentions', DMs to 'all'.
  level             text check (level in ('all', 'mentions', 'none')),
  -- null = not muted; 'infinity' = muted until turned off.
  muted_until       timestamptz,
  suppress_everyone boolean not null default false,
  updated_at        timestamptz not null default now(),
  primary key (user_id, scope_id)
);

alter table public.notification_settings enable row level security;

drop policy if exists notification_settings_own on public.notification_settings;
create policy notification_settings_own on public.notification_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.notification_settings to authenticated;

-- -------------------------------------------------------------------------------------------
-- 2. Custom status expiry
-- -------------------------------------------------------------------------------------------
alter table public.users add column if not exists custom_status_expires_at timestamptz;
grant update (custom_status_expires_at) on public.users to authenticated;

-- -------------------------------------------------------------------------------------------
-- 3. Unread summary that respects notification settings
--    Channel level: channel setting, else server setting, else 'mentions'.
--    'none' → no mention badge. suppress_everyone (server) → @everyone/@here alone doesn't count.
-- -------------------------------------------------------------------------------------------
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
  my_roles as (select coalesce(array_agg(mr.role_id), '{}') as ids from public.member_roles mr where mr.user_id = (select id from me)),
  chans as (
    select c.id, c.server_id, c.last_message_at,
           coalesce(rs.last_read_at, sm.joined_at) as last_read_at,
           coalesce(cs.level, ss.level, 'mentions') as level,
           coalesce(ss.suppress_everyone, false) as suppress_everyone
      from public.channels c
      join public.server_members sm on sm.server_id = c.server_id and sm.user_id = (select id from me)
      left join public.channel_read_states rs on rs.channel_id = c.id and rs.user_id = (select id from me)
      left join public.notification_settings cs on cs.user_id = (select id from me) and cs.scope_id = c.id
      left join public.notification_settings ss on ss.user_id = (select id from me) and ss.scope_id = c.server_id
     where c.type = 'text'
       and public.has_channel_permission(c.id, public.permission_bit('VIEW_CHANNEL'))
  )
  select ch.id, 'channel', ch.server_id, ch.last_message_at, ch.last_read_at,
         case when ch.level = 'none' or ch.last_message_at is null or ch.last_message_at <= ch.last_read_at then 0 else (
           select least(count(*), 99)::integer from public.messages m
            where m.channel_id = ch.id and m.created_at > ch.last_read_at
              and m.author_id is distinct from (select id from me)
              and ((select id from me) = any (m.mentions)
                   or (m.mention_everyone and not ch.suppress_everyone)
                   or m.mention_roles && (select ids from my_roles))
         ) end
    from chans ch
  union all
  select cv.id, cv.type::text, null::uuid, cv.last_message_at, cm.last_read_at,
         case when cv.last_message_at <= cm.last_read_at or ns.level = 'none' then 0 else (
           select least(count(*), 99)::integer from public.messages m
            where m.conversation_id = cv.id and m.created_at > cm.last_read_at
              and m.author_id is distinct from (select id from me)
         ) end
    from public.conversations cv
    join public.conversation_members cm on cm.conversation_id = cv.id and cm.user_id = (select id from me)
    left join public.notification_settings ns on ns.user_id = (select id from me) and ns.scope_id = cv.id
$$;

-- -------------------------------------------------------------------------------------------
-- 4. Inbox: recent messages that mention me (direct, @everyone/@here, or one of my roles).
--    SECURITY INVOKER, so messages RLS decides what I can see.
-- -------------------------------------------------------------------------------------------
create index if not exists messages_mention_everyone_idx on public.messages (created_at desc) where mention_everyone;
create index if not exists messages_mention_roles_idx on public.messages using gin (mention_roles);

create or replace function public.recent_mentions(p_before timestamptz default null, p_limit integer default 50)
returns setof public.messages
language sql stable security invoker set search_path = '' as $$
  select m.*
    from public.messages m
   where m.author_id is distinct from auth.uid()
     and (p_before is null or m.created_at < p_before)
     and (auth.uid() = any (m.mentions)
          or m.mention_everyone
          or m.mention_roles && (select coalesce(array_agg(mr.role_id), '{}') from public.member_roles mr where mr.user_id = auth.uid()))
   order by m.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

grant execute on function public.recent_mentions(timestamptz, integer) to authenticated;
revoke all on function public.recent_mentions(timestamptz, integer) from public, anon;
grant execute on function public.recent_mentions(timestamptz, integer) to authenticated;
revoke all on public.notification_settings from anon;
