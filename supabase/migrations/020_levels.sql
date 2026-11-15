-- Aether 1.8.2: server levels and XP, leaderboards, and stats for profile achievements.
-- Run after 019_watch_onboarding.sql.

-- -------------------------------------------------------------------------------------------
-- 1. Levels: chatting in a server earns 15-25 XP, at most once a minute (so spamming doesn't
--    pay). Each level needs 5·L² + 50·L + 100 more XP than the last.
-- -------------------------------------------------------------------------------------------
alter table public.servers add column if not exists levels_enabled boolean not null default true;
alter table public.servers add column if not exists levels_announce boolean not null default true;
grant update (levels_enabled, levels_announce) on public.servers to authenticated;

create table if not exists public.member_xp (
  server_id  uuid not null,
  user_id    uuid not null,
  xp         integer not null default 0 check (xp >= 0),
  level      integer not null default 0 check (level >= 0),
  messages   integer not null default 0 check (messages >= 0),
  last_award timestamptz,
  primary key (server_id, user_id),
  foreign key (server_id, user_id) references public.server_members (server_id, user_id) on delete cascade
);
create index if not exists member_xp_rank on public.member_xp (server_id, xp desc);
alter table public.member_xp enable row level security;
drop policy if exists xp_read on public.member_xp;
create policy xp_read on public.member_xp for select to authenticated
  using (exists (select 1 from public.server_members m where m.server_id = member_xp.server_id and m.user_id = (select auth.uid())));
grant select on public.member_xp to authenticated;

create or replace function public.level_for_xp(p_xp integer)
returns integer language plpgsql immutable set search_path = '' as $$
declare l integer := 0; need integer := 100; total integer := 0;
begin
  loop
    exit when total + need > p_xp;
    total := total + need;
    l := l + 1;
    need := 5 * l * l + 50 * l + 100;
  end loop;
  return l;
end;
$$;

create or replace function public.award_message_xp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_server public.servers;
  v_row public.member_xp;
  v_gain integer := 0;
  v_level integer;
  v_name text;
begin
  if new.channel_id is null or new.author_id is null or coalesce(new.is_bot, false) then return new; end if;
  select s.* into v_server from public.servers s join public.channels c on c.server_id = s.id where c.id = new.channel_id;
  if v_server.id is null or not v_server.levels_enabled then return new; end if;
  if not exists (select 1 from public.server_members where server_id = v_server.id and user_id = new.author_id) then return new; end if;

  insert into public.member_xp (server_id, user_id) values (v_server.id, new.author_id) on conflict do nothing;
  select * into v_row from public.member_xp where server_id = v_server.id and user_id = new.author_id for update;
  if v_row.last_award is null or v_row.last_award < now() - interval '60 seconds' then
    v_gain := 15 + floor(random() * 11)::integer;
  end if;
  v_level := public.level_for_xp(v_row.xp + v_gain);
  update public.member_xp
     set xp = xp + v_gain, level = v_level, messages = messages + 1,
         last_award = case when v_gain > 0 then now() else last_award end
   where server_id = v_server.id and user_id = new.author_id;

  -- Level up: the built-in bot congratulates them in the same channel (when the bot is on).
  if v_level > v_row.level and v_server.bot_enabled and v_server.levels_announce then
    select username into v_name from public.users where id = new.author_id;
    perform public.bot_post(new.channel_id, format('🎉 @%s just reached **level %s**!', v_name, v_level), new.author_id, 'level');
  end if;
  return new;
end;
$$;
drop trigger if exists award_message_xp on public.messages;
create trigger award_message_xp after insert on public.messages for each row execute function public.award_message_xp();

create or replace function public.server_leaderboard(p_server_id uuid, p_limit integer default 50)
returns table (user_id uuid, xp integer, level integer, messages integer, rank bigint)
language sql stable security definer set search_path = '' as $$
  select x.user_id, x.xp, x.level, x.messages, rank() over (order by x.xp desc)
    from public.member_xp x
   where x.server_id = p_server_id
     and exists (select 1 from public.server_members m where m.server_id = p_server_id and m.user_id = auth.uid())
   order by x.xp desc
   limit least(greatest(p_limit, 1), 100)
$$;
revoke all on function public.server_leaderboard(uuid, integer), public.level_for_xp(integer) from public, anon;
grant execute on function public.server_leaderboard(uuid, integer), public.level_for_xp(integer) to authenticated;

-- -------------------------------------------------------------------------------------------
-- 2. Stats for profile achievements: messages sent and reactions given (counts only).
-- -------------------------------------------------------------------------------------------
create table if not exists public.user_stats (
  user_id   uuid primary key references public.users (id) on delete cascade,
  messages  integer not null default 0,
  reactions integer not null default 0
);
alter table public.user_stats enable row level security;
drop policy if exists stats_read on public.user_stats;
create policy stats_read on public.user_stats for select to authenticated using (true);
grant select on public.user_stats to authenticated;

create or replace function public.count_message_stat()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.author_id is not null and not coalesce(new.is_bot, false) then
    insert into public.user_stats (user_id, messages) values (new.author_id, 1)
    on conflict (user_id) do update set messages = public.user_stats.messages + 1;
  end if;
  return new;
end;
$$;
drop trigger if exists count_message_stat on public.messages;
create trigger count_message_stat after insert on public.messages for each row execute function public.count_message_stat();

create or replace function public.count_reaction_stat()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_stats (user_id, reactions) values (new.user_id, 1)
  on conflict (user_id) do update set reactions = public.user_stats.reactions + 1;
  return new;
end;
$$;
drop trigger if exists count_reaction_stat on public.message_reactions;
create trigger count_reaction_stat after insert on public.message_reactions for each row execute function public.count_reaction_stat();

-- Start everyone off with what they've already done.
insert into public.user_stats (user_id, messages, reactions)
select u.id,
       (select count(*) from public.messages m where m.author_id = u.id and not coalesce(m.is_bot, false))::integer,
       (select count(*) from public.message_reactions r where r.user_id = u.id)::integer
  from public.users u
on conflict (user_id) do update set messages = excluded.messages, reactions = excluded.reactions;
