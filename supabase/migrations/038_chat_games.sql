-- 038: mini-games in chats (2.1). Turn-based games (tic-tac-toe, connect four) that live in a chat
-- (DM, group or channel). Anyone who can read the chat can watch; anyone who can post there can
-- start one or take the empty seat. Every move goes through play_move(), which checks it's your
-- turn and the move is legal, so the board can't be tampered with.

create table if not exists public.chat_games (
  id         uuid primary key default gen_random_uuid(),
  scope_id   uuid not null,
  kind       text not null check (kind in ('tictactoe', 'connect4')),
  player_a   uuid references public.users (id) on delete set null,
  player_b   uuid references public.users (id) on delete set null,
  board      text not null,
  turn       smallint not null default 0 check (turn in (0, 1)),
  -- null while playing; 0 or 1 = that player won; 2 = draw.
  winner     smallint check (winner in (0, 1, 2)),
  moves      smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_games_scope on public.chat_games (scope_id, created_at desc);
create index if not exists chat_games_player_a on public.chat_games (player_a);
create index if not exists chat_games_player_b on public.chat_games (player_b);

alter table public.chat_games enable row level security;
drop policy if exists mfa_required on public.chat_games;
create policy mfa_required on public.chat_games as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
drop policy if exists not_banned on public.chat_games;
create policy not_banned on public.chat_games as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));
drop policy if exists watch on public.chat_games;
create policy watch on public.chat_games for select to authenticated using (public.can_read_scope(scope_id));
-- Changes only through the functions below.
revoke all on public.chat_games from anon, authenticated;
grant select on public.chat_games to authenticated;

create or replace function public.game_empty_board(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select repeat('.', case p_kind when 'tictactoe' then 9 else 42 end)
$$;

-- Who won on this board? 0/1 for a player, 2 for a full board, null if still going.
create or replace function public.game_result(p_kind text, p_board text)
returns smallint language plpgsql immutable set search_path = '' as $$
declare
  v_lines int[][] := array[[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]];
  v_c text;
  r int; c int; d int; k int;
  v_dr int[] := array[0, 1, 1, 1];
  v_dc int[] := array[1, 0, 1, -1];
  v_ok boolean;
begin
  if p_kind = 'tictactoe' then
    for i in 1 .. 8 loop
      v_c := substr(p_board, v_lines[i][1], 1);
      if v_c <> '.' and v_c = substr(p_board, v_lines[i][2], 1) and v_c = substr(p_board, v_lines[i][3], 1) then
        return case v_c when 'A' then 0 else 1 end;
      end if;
    end loop;
  else
    -- 6 rows x 7 columns, row 0 at the top; cell index = r * 7 + c (0-based).
    for r in 0 .. 5 loop
      for c in 0 .. 6 loop
        v_c := substr(p_board, r * 7 + c + 1, 1);
        continue when v_c = '.';
        for d in 1 .. 4 loop
          v_ok := true;
          for k in 1 .. 3 loop
            if r + v_dr[d] * k not between 0 and 5 or c + v_dc[d] * k not between 0 and 6
               or substr(p_board, (r + v_dr[d] * k) * 7 + (c + v_dc[d] * k) + 1, 1) <> v_c then
              v_ok := false;
              exit;
            end if;
          end loop;
          if v_ok then return case v_c when 'A' then 0 else 1 end; end if;
        end loop;
      end loop;
    end loop;
  end if;
  if position('.' in p_board) = 0 then return 2; end if;
  return null;
end;
$$;

create or replace function public.start_game(p_scope uuid, p_kind text, p_opponent uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.can_write_scope(p_scope) then
    raise exception 'You can’t start a game here.' using errcode = '42501';
  end if;
  if p_kind not in ('tictactoe', 'connect4') then raise exception 'Unknown game.' using errcode = '22023'; end if;
  if (select count(*) from public.chat_games g where g.scope_id = p_scope and g.winner is null and g.created_at > now() - interval '7 days') >= 20 then
    raise exception 'This chat has 20 games going already. Finish one first.' using errcode = 'P0001';
  end if;
  if p_opponent = auth.uid() then p_opponent := null; end if;
  insert into public.chat_games (scope_id, kind, player_a, player_b, board)
  values (p_scope, p_kind, auth.uid(), p_opponent, public.game_empty_board(p_kind))
  returning id into v_id;
  return v_id;
end;
$$;

-- Take the empty seat.
create or replace function public.join_game(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.chat_games%rowtype;
begin
  select * into g from public.chat_games where id = p_game for update;
  if not found or not public.can_write_scope(g.scope_id) then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if g.player_a = auth.uid() then raise exception 'You’re already in this game.' using errcode = 'P0001'; end if;
  if g.player_b is not null then raise exception 'Someone took that seat.' using errcode = 'P0001'; end if;
  update public.chat_games set player_b = auth.uid(), updated_at = now() where id = p_game;
end;
$$;

-- p_cell: tic-tac-toe 0..8; connect four: the column 0..6 (the piece drops to the bottom).
create or replace function public.play_move(p_game uuid, p_cell integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.chat_games%rowtype;
  v_me smallint;
  v_idx int;
  v_board text;
  r int;
begin
  select * into g from public.chat_games where id = p_game for update;
  if not found or not public.can_write_scope(g.scope_id) then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if g.winner is not null then raise exception 'This game is over.' using errcode = 'P0001'; end if;
  if g.player_b is null then raise exception 'Waiting for someone to join.' using errcode = 'P0001'; end if;
  v_me := case auth.uid() when g.player_a then 0 when g.player_b then 1 end;
  if v_me is null then raise exception 'You’re watching this game.' using errcode = '42501'; end if;
  if v_me <> g.turn then raise exception 'It’s not your turn.' using errcode = 'P0001'; end if;

  if g.kind = 'tictactoe' then
    if p_cell not between 0 and 8 or substr(g.board, p_cell + 1, 1) <> '.' then raise exception 'You can’t play there.' using errcode = '22023'; end if;
    v_idx := p_cell;
  else
    if p_cell not between 0 and 6 then raise exception 'You can’t play there.' using errcode = '22023'; end if;
    v_idx := null;
    for r in reverse 5 .. 0 loop
      if substr(g.board, r * 7 + p_cell + 1, 1) = '.' then v_idx := r * 7 + p_cell; exit; end if;
    end loop;
    if v_idx is null then raise exception 'That column is full.' using errcode = '22023'; end if;
  end if;

  v_board := overlay(g.board placing case v_me when 0 then 'A' else 'B' end from v_idx + 1 for 1);
  update public.chat_games
     set board = v_board, turn = 1 - g.turn, moves = g.moves + 1, winner = public.game_result(g.kind, v_board), updated_at = now()
   where id = p_game;
end;
$$;

-- Give up (counts as a win for the other player) or cancel a game nobody joined.
create or replace function public.leave_game(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.chat_games%rowtype;
begin
  select * into g from public.chat_games where id = p_game for update;
  if not found or auth.uid() not in (g.player_a, coalesce(g.player_b, g.player_a)) then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if g.player_b is null then
    delete from public.chat_games where id = p_game;
  elsif g.winner is null then
    update public.chat_games set winner = case when auth.uid() = g.player_a then 1 else 0 end, updated_at = now() where id = p_game;
  end if;
end;
$$;

-- Same players, new board, the other one goes first.
create or replace function public.rematch(p_game uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g public.chat_games%rowtype; v_id uuid;
begin
  select * into g from public.chat_games where id = p_game;
  if not found or auth.uid() not in (g.player_a, g.player_b) or g.winner is null or not public.can_write_scope(g.scope_id) then
    raise exception 'Can’t start a rematch.' using errcode = 'P0001';
  end if;
  insert into public.chat_games (scope_id, kind, player_a, player_b, board)
  values (g.scope_id, g.kind, g.player_b, g.player_a, public.game_empty_board(g.kind))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.game_empty_board(text), public.game_result(text, text) from public, anon, authenticated;
revoke all on function public.start_game(uuid, text, uuid), public.join_game(uuid), public.play_move(uuid, integer),
                       public.leave_game(uuid), public.rematch(uuid) from public, anon;
grant execute on function public.start_game(uuid, text, uuid), public.join_game(uuid), public.play_move(uuid, integer),
                          public.leave_game(uuid), public.rematch(uuid) to authenticated;

-- Finished or abandoned games are cleared after a week.
create or replace function public.purge_old_games()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.chat_games where updated_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_old_games() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'aether-purge-games';
    perform cron.schedule('aether-purge-games', '47 4 * * *', 'select public.purge_old_games()');
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_games') then
    alter publication supabase_realtime add table public.chat_games;
  end if;
end;
$$;
