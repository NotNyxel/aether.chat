/** Mini-games in chats (2.1): tic-tac-toe and connect four, played live. Moves are checked by the server. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { liveChannel } from '../lib/live';
import { useSupabase } from '../lib/supabase';

export type GameKind = 'tictactoe' | 'connect4';

export interface ChatGame {
  id: string;
  scope_id: string;
  kind: GameKind;
  player_a: string | null;
  player_b: string | null;
  board: string;
  turn: 0 | 1;
  winner: 0 | 1 | 2 | null;
  moves: number;
  created_at: string;
  updated_at: string;
}

export const GAME_NAMES: Record<GameKind, string> = { tictactoe: 'Tic-tac-toe', connect4: 'Connect Four' };

export function useChatGames(scopeId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const key = ['chat-games', scopeId];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await sb.from('chat_games').select('*').eq('scope_id', scopeId).order('created_at', { ascending: false }).limit(40);
      if (error) throw new Error(error.message);
      return data as ChatGame[];
    },
  });
  useEffect(
    () =>
      liveChannel(
        sb,
        `games:${scopeId}`,
        (c) =>
          c.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_games', filter: `scope_id=eq.${scopeId}` }, (p) =>
            qc.setQueryData<ChatGame[]>(['chat-games', scopeId], (rows = []) => {
              if (p.eventType === 'DELETE') return rows.filter((r) => r.id !== (p.old as { id: string }).id);
              const g = p.new as ChatGame;
              return rows.some((r) => r.id === g.id) ? rows.map((r) => (r.id === g.id ? g : r)) : [g, ...rows];
            }),
          ),
        () => void qc.invalidateQueries({ queryKey: ['chat-games', scopeId] }),
      ),
    [qc, sb, scopeId],
  );
  return { games: q.data ?? [], loading: q.isLoading };
}

export function useGameActions(scopeId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['chat-games', scopeId] });
  const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };
  return {
    start: useMutation({ mutationFn: (kind: GameKind) => rpc<string>('start_game', { p_scope: scopeId, p_kind: kind }), onSettled: refresh }),
    join: useMutation({ mutationFn: (id: string) => rpc('join_game', { p_game: id }), onSettled: refresh }),
    move: useMutation({ mutationFn: ({ id, cell }: { id: string; cell: number }) => rpc('play_move', { p_game: id, p_cell: cell }), onSettled: refresh }),
    leave: useMutation({ mutationFn: (id: string) => rpc('leave_game', { p_game: id }), onSettled: refresh }),
    rematch: useMutation({ mutationFn: (id: string) => rpc<string>('rematch', { p_game: id }), onSettled: refresh }),
  };
}
