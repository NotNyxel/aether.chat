/**
 * Global online presence. Every signed-in client joins the private Realtime topic `online:global`
 * and tracks `{ userId, status, activity }`. Invisible users do not track at all, so they appear offline.
 * `activity` is the opt-in "Playing …" game name and `listening` the opt-in Spotify track; both only
 * live in presence, never in the database.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useSupabase } from '../lib/supabase';
import type { PresenceStatus } from '../types/db';

export type VisibleStatus = Exclude<PresenceStatus, 'invisible'> | 'offline';

const PresenceContext = createContext<ReadonlyMap<string, VisibleStatus>>(new Map());
const ActivityContext = createContext<ReadonlyMap<string, string>>(new Map());
const ListeningContext = createContext<ReadonlyMap<string, Listening>>(new Map());

/** What someone is playing on Spotify. `started_at` is when the track started (epoch ms). */
export interface Listening {
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  started_at: number;
  playing: boolean;
}

function asListening(v: unknown): Listening | null {
  const l = v as Listening | null;
  if (!l || typeof l !== 'object' || typeof l.title !== 'string' || !l.title || l.title.length > 300) return null;
  return {
    title: l.title.slice(0, 300),
    artist: String(l.artist ?? '').slice(0, 300),
    album: String(l.album ?? '').slice(0, 300),
    duration_ms: Number(l.duration_ms) || 0,
    started_at: Number(l.started_at) || Date.now(),
    playing: !!l.playing,
  };
}

interface Meta {
  userId: string;
  status: VisibleStatus;
  activity?: string | null;
  listening?: Listening | null;
}

export function PresenceProvider({ userId, status, activity = null, listening = null, children }: {
  userId: string;
  status: PresenceStatus;
  activity?: string | null;
  listening?: Listening | null;
  children: ReactNode;
}) {
  const sb = useSupabase();
  const [online, setOnline] = useState<ReadonlyMap<string, VisibleStatus>>(new Map());
  const [activities, setActivities] = useState<ReadonlyMap<string, string>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const statusRef = useRef(status);
  const activityRef = useRef(activity);
  const listeningRef = useRef(listening);
  const [tracks, setTracks] = useState<ReadonlyMap<string, Listening>>(new Map());

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
        const acts = new Map<string, string>();
        const music = new Map<string, Listening>();
        const state = ch!.presenceState<Meta>();
        for (const metas of Object.values(state)) {
          const latest = metas[metas.length - 1];
          if (!latest || typeof latest.userId !== 'string') continue;
          next.set(latest.userId, latest.status ?? 'online');
          // Any of the user's open clients may be playing something.
          const playing = metas.map((x) => x.activity).find((a) => typeof a === 'string' && a.length > 0 && a.length <= 128);
          if (playing) acts.set(latest.userId, playing);
          const track = metas.map((x) => asListening(x.listening)).find(Boolean);
          if (track) music.set(latest.userId, track);
        }
        setOnline(next);
        setActivities(acts);
        setTracks(music);
      });
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED' && statusRef.current !== 'invisible') {
          void ch!.track({ userId, status: statusRef.current, activity: activityRef.current, listening: listeningRef.current });
        }
      });
    })();

    return () => {
      cancelled = true;
      channelRef.current = null;
      if (ch) void sb.removeChannel(ch);
    };
  }, [sb, userId]);

  // Status or activity changes: re-track, or untrack to go invisible.
  useEffect(() => {
    statusRef.current = status;
    activityRef.current = activity;
    listeningRef.current = listening;
    const ch = channelRef.current;
    if (!ch) return;
    if (status === 'invisible') void ch.untrack();
    else void ch.track({ userId, status, activity, listening });
  }, [status, activity, listening, userId]);

  return (
    <PresenceContext.Provider value={online}>
      <ActivityContext.Provider value={activities}>
        <ListeningContext.Provider value={tracks}>{children}</ListeningContext.Provider>
      </ActivityContext.Provider>
    </PresenceContext.Provider>
  );
}

/** The Spotify track a user is sharing, if any. */
export function useListeningOf(userId: string | null | undefined): Listening | null {
  const map = useContext(ListeningContext);
  return (userId && map.get(userId)) || null;
}

/** "Playing …" game name for a user, if they share it and are online. */
export function useActivityOf(userId: string | null | undefined): string | null {
  const map = useContext(ActivityContext);
  return (userId && map.get(userId)) || null;
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

/**
 * Status icon, positioned by the caller (usually bottom-right of an avatar): a filled dot for
 * Online, a crescent moon for Idle, a dot with a bar for Do Not Disturb, and a hollow ring for
 * Offline/Invisible. One SVG whose mask shapes slide between states, so changes morph smoothly
 * when "Animate status icons" is on (Settings → Appearance).
 */
export function PresenceDot({ status, size = 12, className = '' }: { status: VisibleStatus; size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <span
      className={`ae-status inline-grid shrink-0 place-items-center rounded-full bg-ae-elevated ${className}`}
      data-status={status}
      // Always above the avatar (and its frame or decoration), unless the caller sets its own layer.
      style={{ width: size, height: size, zIndex: /(^|\s)z-/.test(className) ? undefined : 5 }}
      title={STATUS_LABELS[status]}
      role="img"
      aria-label={STATUS_LABELS[status]}
    >
      <svg width={Math.max(6, size - 4)} height={Math.max(6, size - 4)} viewBox="0 0 10 10" aria-hidden="true">
        <mask id={`m${id}`}>
          <rect width="10" height="10" fill="white" />
          {/* idle: a circle that bites out of the top-left, making a moon */}
          <circle className="ae-status-moon" cx="2.5" cy="2.5" r="3.75" fill="black" />
          {/* dnd: a horizontal bar */}
          <rect className="ae-status-bar" x="2" y="4" width="6" height="2" rx="1" fill="black" />
          {/* offline: the inner hole of a ring */}
          <circle className="ae-status-hole" cx="5" cy="5" r="2.5" fill="black" />
        </mask>
        <circle cx="5" cy="5" r="5" fill={DOT_COLORS[status]} mask={`url(#m${id})`} className="ae-status-fill" />
      </svg>
    </span>
  );
}
