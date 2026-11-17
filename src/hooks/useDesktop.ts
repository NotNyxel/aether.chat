/** App-level desktop behaviour: auto-idle, game activity, taskbar badge, tray, custom status expiry. */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { idleSeconds, nowPlaying, runningGame, runningProcesses, setBadge, setCloseToTray } from '../lib/desktop';
import { detectGame } from '../lib/games';
import { lookupAlbumArt } from '../lib/activityArt';

/** Covers found this session, per song. */
const artCache = new Map<string, string | null>();
import { isTauri } from '../lib/platform';
import { useSettingsStore } from '../stores/settingsStore';
import type { PresenceStatus, UserProfile } from '../types/db';
import type { GameActivity, Listening } from './usePresence';
import { useUpdateProfile } from './useChatData';

/**
 * While your chosen status is Online, shows you as Idle after `autoIdleMinutes` without keyboard or
 * mouse input (system-wide on desktop). Your saved status is untouched; this only changes presence.
 */
export function useAutoIdle(status: PresenceStatus): PresenceStatus {
  const minutes = useSettingsStore((s) => s.system.autoIdleMinutes);
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (status !== 'online' || minutes <= 0) {
      setIdle(false);
      return;
    }
    let stopped = false;
    const check = async () => {
      const secs = await idleSeconds().catch(() => 0);
      if (!stopped) setIdle(secs >= minutes * 60);
    };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [status, minutes]);
  return status === 'online' && idle ? 'idle' : status;
}

/**
 * Opt-in "Playing …" detection (desktop only), checked every 15 seconds: your own games first, then
 * any game installed by Steam, Epic, GOG, Ubisoft or Xbox, then a list of well-known games.
 * Carries when you started and your playing mode (Playing / Locked in / AFK).
 */
export function useGameActivity(): GameActivity | null {
  const { shareActivity, customGames, mode } = useSettingsStore((s) => s.activity);
  const [game, setGame] = useState<{ name: string; since: number } | null>(null);
  useEffect(() => {
    if (!shareActivity || !isTauri) {
      setGame(null);
      return;
    }
    let stopped = false;
    const scan = async () => {
      const procs = await runningProcesses().catch(() => []);
      const name = (customGames.length ? detectGame(procs, customGames.filter(Boolean)) : null) ?? (await runningGame()) ?? detectGame(procs, []);
      if (stopped) return;
      // Same game as before: keep its start time.
      setGame((cur) => (name ? (cur?.name === name ? cur : { name, since: Date.now() }) : null));
    };
    void scan();
    const t = setInterval(() => void scan(), 15_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [shareActivity, customGames]);
  return useMemo(() => (game ? { ...game, mode } : null), [game, mode]);
}

/** Your Spotify track, paused or playing, for your own mini-player (only playing ones are shared). */
export const useNowPlaying = create<{ track: Listening | null }>()(() => ({ track: null }));

/** Opt-in Listening to Spotify: polls the media session every 5 s and publishes the track. */
export function useSpotifyListening(): Listening | null {
  const share = useSettingsStore((s) => s.activity.shareSpotify);
  const [track, setTrack] = useState<Listening | null>(null);
  useEffect(() => {
    if (!share || !isTauri) {
      setTrack(null);
      return;
    }
    let stopped = false;
    const poll = async () => {
      const np = await nowPlaying().catch(() => null);
      if (stopped) return;
      if (!np) return setTrack(null);
      const started = Date.now() - np.position_ms;
      const key = `${np.title}\u0000${np.artist}`;
      setTrack((cur) =>
        // Only republish when the track changes, it's paused/resumed, or someone seeks (drift over
        // 3 s), to keep presence quiet.
        cur && cur.title === np.title && cur.artist === np.artist && cur.playing === np.playing && Math.abs(cur.started_at - started) < 3000
          ? cur
          : { title: np.title, artist: np.artist, album: np.album, duration_ms: np.duration_ms, started_at: started, playing: np.playing, art: artCache.get(key) ?? cur?.art ?? null },
      );
      // New song: find its cover once and share it with the track.
      if (!artCache.has(key)) {
        artCache.set(key, null);
        const art = await lookupAlbumArt(np.title, np.artist).catch(() => null);
        artCache.set(key, art);
        if (!stopped && art) setTrack((cur) => (cur && cur.title === np.title && cur.artist === np.artist ? { ...cur, art } : cur));
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 5_000);
    const now = () => void poll();
    window.addEventListener('aether-np-refresh', now);
    return () => {
      stopped = true;
      clearInterval(t);
      window.removeEventListener('aether-np-refresh', now);
    };
  }, [share]);
  useEffect(() => useNowPlaying.setState({ track }), [track]);
  // Friends only see a song while it's actually playing.
  return track?.playing ? track : null;
}

export function useTaskbarBadge(count: number): void {
  const enabled = useSettingsStore((s) => s.notifications.taskbarBadge);
  useEffect(() => {
    void setBadge(enabled ? count : 0);
  }, [count, enabled]);
}

export function useTraySync(): void {
  const closeToTray = useSettingsStore((s) => s.system.closeToTray);
  useEffect(() => {
    void setCloseToTray(closeToTray).catch(() => undefined);
  }, [closeToTray]);
}

/** The custom status, or null once it has expired. */
export function activeCustomStatus(p: Pick<UserProfile, 'custom_status' | 'custom_status_expires_at'> | null | undefined): string | null {
  if (!p?.custom_status) return null;
  if (p.custom_status_expires_at && Date.parse(p.custom_status_expires_at) <= Date.now()) return null;
  return p.custom_status;
}

/** Clears your own custom status when its timer runs out (others already hide it via activeCustomStatus). */
export function useCustomStatusExpiry(userId: string, me: UserProfile | null | undefined): void {
  const update = useUpdateProfile(userId);
  const { mutate } = update;
  const expires = me?.custom_status ? me.custom_status_expires_at : null;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!expires) return;
    const ms = Date.parse(expires) - Date.now();
    const clear = () => mutate({ custom_status: null, status_emoji: null, custom_status_expires_at: null });
    if (ms <= 0) {
      clear();
      return;
    }
    // setTimeout overflows above ~24.8 days; re-check daily instead.
    const t = setTimeout(() => (Date.parse(expires) <= Date.now() ? clear() : setTick((n) => n + 1)), Math.min(ms, 86_400_000));
    return () => clearTimeout(t);
  }, [expires, mutate, tick]);
}
