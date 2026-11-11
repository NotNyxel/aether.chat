/**
 * Global online presence. Every signed-in client joins the private Realtime topic `online:global`
 * and tracks `{ userId, status }`. Invisible users do not track at all, so they appear offline.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useSupabase } from '../lib/supabase';
import type { PresenceStatus } from '../types/db';

export type VisibleStatus = Exclude<PresenceStatus, 'invisible'> | 'offline';

const PresenceContext = createContext<ReadonlyMap<string, VisibleStatus>>(new Map());

export function PresenceProvider({ userId, status, children }: { userId: string; status: PresenceStatus; children: ReactNode }) {
  const sb = useSupabase();
  const [online, setOnline] = useState<ReadonlyMap<string, VisibleStatus>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const statusRef = useRef(status);

  useEffect(() => {
    let cancelled = false;
    let ch: RealtimeChannel | null = null;

    void (async () => {
      await sb.realtime.setAuth();
      if (cancelled) return;
      ch = sb.channel('online:global', { config: { private: true, presence: { key: userId } } });
      channelRef.current = ch;
      ch.on('presence', { event: 'sync' }, () => {
        const next = new Map<string, VisibleStatus>();
        const state = ch!.presenceState<{ userId: string; status: VisibleStatus }>();
        for (const metas of Object.values(state)) {
          const latest = metas[metas.length - 1];
          if (latest && typeof latest.userId === 'string') next.set(latest.userId, latest.status ?? 'online');
        }
        setOnline(next);
      });
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED' && statusRef.current !== 'invisible') {
          void ch!.track({ userId, status: statusRef.current });
        }
      });
    })();

    return () => {
      cancelled = true;
      channelRef.current = null;
      if (ch) void sb.removeChannel(ch);
    };
  }, [sb, userId]);

  // Status changes: re-track, or untrack to go invisible.
  useEffect(() => {
    statusRef.current = status;
    const ch = channelRef.current;
    if (!ch) return;
    if (status === 'invisible') void ch.untrack();
    else void ch.track({ userId, status });
  }, [status, userId]);

  return <PresenceContext.Provider value={online}>{children}</PresenceContext.Provider>;
}

export function usePresenceMap(): ReadonlyMap<string, VisibleStatus> {
  return useContext(PresenceContext);
}

export function usePresenceOf(userId: string | null | undefined): VisibleStatus {
  const map = useContext(PresenceContext);
  return (userId && map.get(userId)) || 'offline';
}

const DOT_COLORS: Record<VisibleStatus, string> = {
  online: 'var(--ae-success)',
  idle: 'var(--ae-warning)',
  dnd: 'var(--ae-danger)',
  offline: 'var(--ae-text-muted)',
};

export const STATUS_LABELS: Record<PresenceStatus | 'offline', string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  invisible: 'Invisible',
  offline: 'Offline',
};

/** Small status dot, positioned by the caller (usually bottom-right of an avatar). */
export function PresenceDot({ status, size = 12, className = '' }: { status: VisibleStatus; size?: number; className?: string }) {
  return (
    <span
      className={`inline-block rounded-full border-2 border-ae-elevated ${className}`}
      style={{ width: size, height: size, background: DOT_COLORS[status] }}
      title={STATUS_LABELS[status]}
    />
  );
}
