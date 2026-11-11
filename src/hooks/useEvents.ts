/** Scheduled server events and RSVPs, plus desktop reminders for events you're interested in. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { notify } from '../lib/desktop';
import { playSound } from '../lib/sounds';
import { useSupabase } from '../lib/supabase';
import type { EventRsvp, EventStatus, ServerEvent } from '../types/db';
import { unwrap } from './useChatData';

export function useServerEvents(serverId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['events', serverId],
    enabled: !!serverId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap(
        await sb
          .from('server_events')
          .select('*')
          .eq('server_id', serverId!)
          .in('status', ['scheduled', 'active'])
          .order('starts_at'),
      ) as ServerEvent[],
  });
}

export function useEventRsvps(eventIds: string[]) {
  const sb = useSupabase();
  const key = [...eventIds].sort().join(',');
  return useQuery({
    queryKey: ['event-rsvps', key],
    enabled: eventIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => unwrap(await sb.from('event_rsvps').select('*').in('event_id', eventIds)) as EventRsvp[],
  });
}

export interface EventInput {
  name: string;
  description: string | null;
  channel_id: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
}

export function useEventActions(serverId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['events', serverId] });
    void qc.invalidateQueries({ queryKey: ['event-rsvps'] });
    void qc.invalidateQueries({ queryKey: ['my-events'] });
  };
  return {
    create: useMutation({
      mutationFn: async (input: EventInput) =>
        unwrap(await sb.from('server_events').insert({ server_id: serverId, ...input }).select().single()) as ServerEvent,
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: Partial<EventInput> & { status?: EventStatus } }) =>
        unwrap(await sb.from('server_events').update(patch).eq('id', id).select().single()) as ServerEvent,
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await sb.from('server_events').delete().eq('id', id).select()),
      onSuccess: refresh,
    }),
    rsvp: useMutation({
      mutationFn: async ({ id, going, userId }: { id: string; going: boolean; userId: string }) =>
        going
          ? unwrap(await sb.from('event_rsvps').insert({ event_id: id }).select())
          : unwrap(await sb.from('event_rsvps').delete().eq('event_id', id).eq('user_id', userId).select()),
      onSuccess: refresh,
    }),
  };
}

const REMINDED_KEY = 'aether.event-reminders';

function reminded(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem(REMINDED_KEY) ?? '{}') as Record<string, true>;
  } catch {
    return {};
  }
}
function markReminded(key: string) {
  try {
    const all = reminded();
    all[key] = true;
    // keep the list small
    const keys = Object.keys(all).slice(-200);
    localStorage.setItem(REMINDED_KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, true]))));
  } catch {
    // storage unavailable; worst case a reminder repeats
  }
}

/** Reminds you 15 minutes before, and when, an event you're interested in starts. */
export function useEventReminders(userId: string, silent: boolean) {
  const sb = useSupabase();
  const { data: mine = [] } = useQuery({
    queryKey: ['my-events', userId],
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const rows = unwrap(await sb.from('event_rsvps').select('event_id, server_events(*)').eq('user_id', userId)) as unknown as {
        event_id: string;
        server_events: ServerEvent | null;
      }[];
      return rows.map((r) => r.server_events).filter((e): e is ServerEvent => !!e && (e.status === 'scheduled' || e.status === 'active'));
    },
  });

  useEffect(() => {
    if (silent || mine.length === 0) return;
    const check = () => {
      const done = reminded();
      const now = Date.now();
      for (const e of mine) {
        const start = Date.parse(e.starts_at);
        const soonKey = `${e.id}:soon`;
        const liveKey = `${e.id}:live`;
        if (e.status === 'active' && !done[liveKey]) {
          markReminded(liveKey);
          markReminded(soonKey);
          playSound('mention');
          void notify(`📅 ${e.name} is starting`, e.location ? `At ${e.location}` : 'Join from the server’s event list.');
        } else if (e.status === 'scheduled' && start - now <= 15 * 60_000 && start - now > -60 * 60_000 && !done[soonKey]) {
          markReminded(soonKey);
          playSound('mention');
          const mins = Math.max(0, Math.round((start - now) / 60_000));
          void notify(`📅 ${e.name}`, mins > 0 ? `Starts in ${mins} minute${mins === 1 ? '' : 's'}.` : 'Starting now.');
        }
      }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, [mine, silent]);
}
