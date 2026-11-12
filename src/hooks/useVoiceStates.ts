/**
 * Server voice states (public.voice_states): who is in which voice or stage channel, live.
 * Drives occupancy in the channel list, LIVE badges, stage roles and moderator voice tools.
 * Rows whose heartbeat is older than 90 seconds belong to crashed clients and are ignored.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSupabase } from '../lib/supabase';
import type { VoiceState } from '../types/db';
import { unwrap } from './useChatData';
import { liveChannel } from '../lib/live';

export const VOICE_STALE_MS = 90_000;

export function isLiveState(v: VoiceState, now = Date.now()): boolean {
  return now - Date.parse(v.updated_at) < VOICE_STALE_MS;
}

export function useVoiceStates(serverId: string | null) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const key = ['voice-states', serverId];
  const query = useQuery({
    queryKey: key,
    enabled: !!serverId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => unwrap(await sb.from('voice_states').select('*').eq('server_id', serverId!)) as VoiceState[],
  });

  useEffect(() => {
    if (!serverId) return;
    const stop = liveChannel(sb, `voice-states:${serverId}:${Math.random().toString(36).slice(2, 8)}`, (c) =>
      c
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_states', filter: `server_id=eq.${serverId}` }, (payload) => {
        qc.setQueryData<VoiceState[]>(['voice-states', serverId], (rows = []) => {
          if (payload.eventType === 'DELETE') return rows.filter((r) => r.user_id !== (payload.old as { user_id?: string }).user_id);
          const row = payload.new as VoiceState;
          return [...rows.filter((r) => r.user_id !== row.user_id), row];
        });
      })
      // Deletes can't be filtered by column, and only carry the primary key under RLS.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'voice_states' }, (payload) => {
        const id = (payload.old as { user_id?: string }).user_id;
        if (id) qc.setQueryData<VoiceState[]>(['voice-states', serverId], (rows = []) => rows.filter((r) => r.user_id !== id));
      }),
      () => void qc.invalidateQueries({ queryKey: ['voice-states', serverId] }),
    );
    return stop;
  }, [qc, sb, serverId]);

  // Re-evaluate staleness periodically even when nothing changes.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const live = useMemo(() => (query.data ?? []).filter((v) => isLiveState(v, now)), [query.data, now]);
  const byChannel = useMemo(() => {
    const map = new Map<string, VoiceState[]>();
    for (const v of live) {
      const list = map.get(v.channel_id) ?? [];
      list.push(v);
      map.set(v.channel_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.joined_at.localeCompare(b.joined_at));
    return map;
  }, [live]);
  const byUser = useMemo(() => new Map(live.map((v) => [v.user_id, v])), [live]);
  return { states: live, byChannel, byUser, isLoading: query.isLoading };
}

export function useVoiceModeration(serverId: string | null) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['voice-states', serverId] });
  const rpc = (fn: string, args: Record<string, unknown>) => async () => unwrap(await sb.rpc(fn, args));
  return {
    moderate: useMutation({
      mutationFn: ({ userId, mute, deaf }: { userId: string; mute?: boolean; deaf?: boolean }) =>
        rpc('voice_moderate', { p_user_id: userId, p_server_mute: mute ?? null, p_server_deaf: deaf ?? null })(),
      onSuccess: refresh,
    }),
    move: useMutation({
      mutationFn: ({ userId, channelId }: { userId: string; channelId: string }) => rpc('voice_move', { p_user_id: userId, p_channel_id: channelId })(),
      onSuccess: refresh,
    }),
    disconnect: useMutation({
      mutationFn: (userId: string) => rpc('voice_disconnect', { p_user_id: userId })(),
      onSuccess: refresh,
    }),
    setSpeaker: useMutation({
      mutationFn: ({ userId, speaker }: { userId: string; speaker: boolean }) => rpc('stage_set_speaker', { p_user_id: userId, p_speaker: speaker })(),
      onSuccess: refresh,
    }),
    raiseHand: useMutation({
      mutationFn: (raise: boolean) => rpc('stage_request_to_speak', { p_raise: raise })(),
      onSuccess: refresh,
    }),
  };
}
