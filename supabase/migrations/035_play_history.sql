-- 035: play history (2.1). While you share your game activity, Aether records play sessions
-- (game, start, end). Your profile can show the last week ("VALORANT 9h") to friends and people you
-- share a space with; you can hide it or clear it any time. Sessions older than 90 days are deleted.

alter table public.users add column if not exists show_play_history boolean not null default true;
grant update (show_play_history) on public.users to authenticated;

create table if not exists public.game_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.users (id) on delete cascade,
  game       text not null check (char_length(btrim(game)) between 1 and 128),
  started_at timestamptz not null,
  ended_at   timestamptz not null,
  check (ended_at >= started_at and ended_at - started_at <= interval '24 hours')
);
create index if not exists game_sessions_user on public.game_sessions (user_id, started_at desc);

alter table public.game_sessions enable row level security;
-- Only you can read or change your own rows; others see totals through play_history() below.
drop policy if exists own on public.game_sessions;
create policy own on public.game_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists mfa_required on public.game_sessions;
create policy mfa_required on public.game_sessions as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
drop policy if exists not_banned on public.game_sessions;
create policy not_banned on public.game_sessions as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));
-- No backdating or far-future sessions.
drop policy if exists recent_only on public.game_sessions;
create policy recent_only on public.game_sessions as restrictive for insert to authenticated
  with check (started_at > now() - interval '1 day' and ended_at < now() + interval '5 minutes');
revoke all on public.game_sessions from anon, authenticated;
grant select, insert, update, delete on public.game_sessions to authenticated;

-- Totals per game for the last p_days (max 30): yours always; someone else's when they show it and
-- you're friends or share a space.
create or replace function public.play_history(p_user uuid, p_days integer default 7)
returns table (game text, seconds bigint, sessions integer, last_played timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;
  if p_user <> v_me then
    if not coalesce((select u.show_play_history from public.users u where u.id = p_user), false) then return; end if;
    if not (public.are_friends(v_me, p_user) or public.shares_server(v_me, p_user)) then return; end if;
    if public.is_blocked_between(v_me, p_user) then return; end if;
  end if;
  return query
    select s.game,
           sum(extract(epoch from (s.ended_at - s.started_at)))::bigint,
           count(*)::integer,
           max(s.ended_at)
      from public.game_sessions s
     where s.user_id = p_user and s.started_at > now() - make_interval(days => least(greatest(p_days, 1), 30))
     group by s.game
     order by 2 desc
     limit 10;
end;
$$;
revoke all on function public.play_history(uuid, integer) from public, anon;
grant execute on function public.play_history(uuid, integer) to authenticated;

create or replace function public.purge_old_game_sessions()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.game_sessions where ended_at < now() - interval '90 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_old_game_sessions() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'aether-purge-game-sessions';
    perform cron.schedule('aether-purge-game-sessions', '17 4 * * *', 'select public.purge_old_game_sessions()');
  end if;
end;
$$;
