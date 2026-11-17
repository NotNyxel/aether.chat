/**
 * Play history (2.1). While you share your game activity, each play session is saved (game, start,
 * end; updated every minute so a crash loses at most a minute). Profiles show the last week to
 * friends and people you share a space with, unless you hide it; you can clear it any time.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { fire, useSupabase } from '../lib/supabase';
import type { GameActivity } from './usePresence';

export interface PlayTotal {
  game: string;
  seconds: number;
  sessions: number;
  last_played: string;
}

/** Records your sessions. Mounted once, with the game you're playing (or null). */
export function useRecordPlaySessions(game: GameActivity | null) {
  const sb = useSupabase();
  const session = useRef<{ id: string; name: string } | null>(null);
  const name = game?.name ?? null;
  const since = game?.since ?? 0;
  useEffect(() => {
    if (!name) return;
    const id = crypto.randomUUID();
    const started = new Date(since || Date.now()).toISOString();
    session.current = { id, name };
    fire(sb.from('game_sessions').insert({ id, game: name.slice(0, 128), started_at: started, ended_at: new Date().toISOString() }));
    const touch = () => fire(sb.from('game_sessions').update({ ended_at: new Date().toISOString() }).eq('id', id));
    const t = setInterval(touch, 60_000);
    return () => {
      clearInterval(t);
      touch();
      session.current = null;
    };
  }, [sb, name, since]);
}

export function usePlayHistory(userId: string | null, days = 7) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['play-history', userId, days],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc('play_history', { p_user: userId, p_days: days });
      if (error) throw new Error(error.message);
      return ((data ?? []) as PlayTotal[]).map((r) => ({ ...r, seconds: Number(r.seconds) }));
    },
  });
}

export function useClearPlayHistory() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await sb.from('game_sessions').delete().not('id', 'is', null);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['play-history'] }),
  });
}

export const hoursText = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
};
